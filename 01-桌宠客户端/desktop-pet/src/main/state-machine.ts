/**
 * PetStateMachine (v0.5.0 重写) —— theme.json driven A/B/C 三类状态机.
 *
 * 来自规格 `给coder-状态逻辑与切换.md`:
 *  - A 循环: 长期停留, 进入即显示循环, 离开即换
 *  - B 回归: 触发一次, 播 durMs 后自动 setState(returnTo)
 *  - C 过渡桥: 锁状态, 播 durMs 后自动 setState(to). 仅 Error 优先级能打断
 *
 * 优先级 (高→低): Error > Notification > CBridge(锁) > Reaction > Working > IdleEgg > Idle
 * 默认 idle 只播 idle.svg; idle 彩蛋 (Stage B armIdleEggs) 20-40s 随机插 B 类.
 * 睡眠链强制走桥: idle → setState('collapse-sleep') (C) → 播完自动 setState('sleeping')
 * → 任意活动 → setState('wake') (C) → 播完自动 setState('idle').
 *
 * Stage A 范围: theme loader 读 + setState 主流程 + A/B/C 处理 + C lock + 老别名兼容.
 * Stage B (后续): armIdleEggs + render 层 crossfade 融合.
 * Stage C (后续): eventMap dispatch + app→state mapping LLM 兜底.
 */

import { lookupState, getTheme } from './storage/theme'
import { StatePriority } from '../shared/theme-types'
import type { ThemeStateDef } from '../shared/theme-types'
import type { LegacyAliasState, PetState } from '../shared/pet-state'

/**
 * 老 crab 时代别名 → Furina canonical state 名映射.
 * setState() 入口先经此 map 把老名子翻译, 再查 theme.json.
 *
 * v0.5.0 引入是因为 main 端 6 处 transition('success'/'sleep'/...) 散落, 一次性
 * 改成 canonical 风险大. Stage A 用 alias 兼容, Stage C 清理 call sites 后再
 * 收掉 ALIAS_MAP.
 */
// keys 类型由 shared/pet-state.LEGACY_ALIAS_NAMES 通过 satisfies 在 TS 编译期强校验:
// 漏掉任何一个 LegacyAliasState 字面量 → 编译错; 多出一个 → 编译错.
// Stage C 已收 (v0.5.x): success / looking_around / poked / awaiting / grooving /
//   celebrating / ultrathink / multitask / moving / organizing —— callers 全部
//   改成 canonical 名 (main/index.ts + PetAnimation + App.tsx 分支同步清).
// 仅保留还在 cc 主题 theme.json 用到的别名 (cc 退役前不能删).
const ALIAS_MAP = {
  sleep: 'sleeping',
  collapsing: 'collapse-sleep',
  waking: 'wake',
  drag: 'react-drag',
  // 老 sleep 链多阶段 → 现在直接走 collapse-sleep C 桥 (规格只要求 2 步, 不要 yawning/dozing)
  yawning: 'idle-yawn',
  dozing: 'idle-yawn',
  working: 'typing'
} as const satisfies Record<LegacyAliasState, string>

/** 按 state 名 (canonical) 推断优先级. State 类型未知时按"工作态"对待 */
function priorityOf(canonical: string, spec: ThemeStateDef | null): StatePriority {
  if (canonical === 'error') return StatePriority.Error
  if (canonical === 'notification') return StatePriority.Notification
  if (canonical.startsWith('react-')) return StatePriority.Reaction
  if (spec?.type === 'C') return StatePriority.CBridge
  if (canonical === 'idle') return StatePriority.Idle
  // idle 彩蛋 (低优先级 B 类)
  if (canonical === 'idle-living' || canonical === 'idle-look' || canonical === 'idle-yawn') {
    return StatePriority.IdleEgg
  }
  // 默认: 工作态 (A 类 thinking/typing/building/juggling/conducting/sweeping/carrying/sleeping)
  return StatePriority.Working
}

/**
 * Hardcoded fallback spec —— theme.json 加载失败时的最小集 (只有 idle).
 * Stage A 不深做兜底, 兜不到就 ignore state 切换 (renderer 仍能显示 idle).
 */
const FALLBACK_IDLE: ThemeStateDef = {
  file: 'svg/idle.svg',
  type: 'A',
  loop: 'pingpong'
}

export class PetStateMachine {
  private current: string = 'idle'
  /** A 类基态 (idle / sleeping / typing / ...). B/C 类播完回这个 */
  private base: string = 'idle'
  /** C 过渡播放中. 仅 Error 优先级可抢, 其它一律 ignore */
  private locked = false
  private currentPriority: StatePriority = StatePriority.Idle
  /** 当前激活的 timer (B 类 returnTo / C 类 setState(to) / idle 60s sleep chain) */
  private timer: NodeJS.Timeout | null = null
  /** Stage B 用: idle 彩蛋调度 timer */
  private idleEggTimer: NodeJS.Timeout | null = null

  /** idle 多久后自动进 sleep 链 (规格 IdleTimeout:60s) */
  private static readonly IDLE_SLEEP_MS = 60_000

  constructor(private notify: (state: PetState) => void) {
    // 冷启动 arm 一次 sleep timer (60s idle 后 setState('collapse-sleep'))
    this.armSleepTimer()
  }

  getState(): PetState {
    return this.current as PetState
  }

  /** A 类基态, B/C 类播完会回到这个 (idle / sleeping / typing 等) */
  getBase(): PetState {
    return this.base as PetState
  }

  /**
   * 状态切换公开入口 (外部调用): 经 lock + 优先级 gate.
   * setState() 拒绝时返 false (gate 没过); 接受时返 true.
   *
   * 老别名 → canonical 翻译 (ALIAS_MAP); theme.json lookup spec; 按 A/B/C 处理.
   */
  setState(name: PetState): boolean {
    // ALIAS_MAP 类型限定 keys 为 LegacyAliasState; setState 接受任意 PetState 名,
    // 这里 widen 到 string-keyed 做查找; 未命中走 canonical 路径.
    const canonical = (ALIAS_MAP as Readonly<Record<string, string>>)[name] ?? (name as string)
    const spec = lookupState(canonical) ?? (canonical === 'idle' ? FALLBACK_IDLE : null)
    if (!spec) {
      console.warn(`[state-machine] unknown state "${name}" (canonical "${canonical}")`)
      return false
    }
    if (canonical === this.current) return false

    const newPrio = priorityOf(canonical, spec)

    // C 锁: 期间只允许 Error 抢占
    if (this.locked && newPrio < StatePriority.Error) {
      return false
    }
    // 优先级 gate (仅外部 setState): 低优先级不能抢高优先级
    // 注意: B 类 returnTo / C 类 to 走 _doSetState 内部路径, 不经此 gate.
    if (newPrio < this.currentPriority) {
      return false
    }

    this._doSetState(canonical, spec, newPrio)
    return true
  }

  /**
   * 内部 state apply (B/C timer fire 用). 跳 lock + 优先级 gate, 强制切换.
   *
   * 必要性: B 类 timer fire setState(returnTo='idle') 时, Idle 优先级 < 当前 B 类
   * 优先级 → 公开 setState() 的 gate 会拒, pet 永远卡死. 内部 _doSetState 直接 apply.
   */
  private _doSetState(canonical: string, spec: ThemeStateDef, newPrio: StatePriority): void {
    // 清除上一态的 timer (B returnTo, C to, sleep arm)
    this.clearTimer()

    this.current = canonical
    this.currentPriority = newPrio
    this.notify(canonical as PetState)

    // 按 type 分支
    if (spec.type === 'A') {
      this.base = canonical
      // 进 idle → arm 60s sleep timer
      if (canonical === 'idle') {
        this.armSleepTimer()
      }
      // 进 sleeping (A) → 不 arm 任何 timer, 等 wakeFromSleep 调
      // 其它 A 类 (typing/building/...) 也不 arm, 等外部 setState 切走
    } else if (spec.type === 'B') {
      // 播 durMs 后自动 setState(returnTo). Furina B sprite 多数 6s pingpong.
      const dur = spec.durMs ?? 6000
      const returnTo = spec.returnTo ?? this.base
      this.timer = setTimeout(() => {
        this.timer = null
        this._internalSetState(returnTo)
      }, dur)
    } else if (spec.type === 'C') {
      // 锁状态, 播 durMs 后自动 setState(to). Furina C sprite (collapse-sleep/wake) 3.08s.
      this.locked = true
      const dur = spec.durMs ?? 3080
      const to = spec.to ?? 'idle'
      this.timer = setTimeout(() => {
        this.timer = null
        this.locked = false
        this._internalSetState(to)
      }, dur)
    }
  }

  /** 包一层 lookup + 调 _doSetState, 给 B/C timer fire 用 */
  private _internalSetState(name: string): void {
    const canonical = ALIAS_MAP[name] ?? name
    const spec = lookupState(canonical) ?? (canonical === 'idle' ? FALLBACK_IDLE : null)
    if (!spec) {
      console.warn(`[state-machine] internal setState unknown "${name}"`)
      return
    }
    if (canonical === this.current) return
    const newPrio = priorityOf(canonical, spec)
    this._doSetState(canonical, spec, newPrio)
  }

  /** 任何用户活动唤醒. sleep chain 任意阶段都能 wake */
  wakeFromSleep(): void {
    // base==='sleeping' 或 current 在 collapse-sleep/sleeping 时唤
    if (
      this.base === 'sleeping' ||
      this.current === 'sleeping' ||
      this.current === 'collapse-sleep'
    ) {
      this.setState('wake' as PetState)
    }
  }

  /** demoCycle 兼容 (托盘菜单): thinking → happy → idle */
  demoCycle(): void {
    this.clearTimer()
    this.setState('thinking' as PetState)
    this.timer = setTimeout(() => {
      this.timer = null
      this.setState('happy' as PetState)
      // happy 是 B 类, durMs 后自动回 idle
    }, 2000)
  }

  /**
   * v0.5.0 兼容老 scheduleReturnToIdle. 实际上新 state machine B 类自带 returnTo,
   * 这个方法是 dead-end —— 老 call sites 在 thinking/poked/looking_around/M8
   * animation 后调它, 现在 B 类已经自带 returnTo='idle' 不需要外部 schedule.
   * 保留是为编译兼容, 内部 no-op. Stage C 清理 call sites.
   */
  scheduleReturnToIdle(holdMs: number): void {
    void holdMs
    // intentionally no-op; B 类 setState 自带 returnTo timer
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private armSleepTimer(): void {
    // 60s 后自动走 collapse-sleep C 桥 (桥会自己 setState('sleeping'))
    this.clearTimer()
    this.timer = setTimeout(() => {
      this.timer = null
      // 只在仍 idle 时才进 sleep (用户期间有过活动会 setState 重置)
      if (this.current === 'idle') {
        this.setState('collapse-sleep' as PetState)
      }
    }, PetStateMachine.IDLE_SLEEP_MS)
  }

  /** Stage B 接入: idle 彩蛋 20-40s 随机. 当前 no-op. */
  armIdleEggs(): void {
    if (this.idleEggTimer) clearTimeout(this.idleEggTimer)
    const theme = getTheme()
    const eggs = theme?.idleEggs ?? []
    if (eggs.length === 0) return
    const delay = 20_000 + Math.random() * 20_000
    this.idleEggTimer = setTimeout(() => {
      this.idleEggTimer = null
      // gate: 仍是纯 idle 才插彩蛋
      if (this.current === 'idle') {
        const egg = eggs[Math.floor(Math.random() * eggs.length)]
        this.setState(egg as PetState) // B 类自动回 idle, 触发下次 re-arm
      }
    }, delay)
  }
}
