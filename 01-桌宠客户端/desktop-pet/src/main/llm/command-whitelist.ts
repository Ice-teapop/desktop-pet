/**
 * Shell 命令安全白名单（M4-C）——
 *
 * 白名单命令：执行不需要 modal（保守、只读、无副作用）。
 * 黑名单 patterns：永远拒绝，approval 也不能放行（rm -rf、curl|sh、sudo 等）。
 * 其它：弹 modal 让用户决定。
 *
 * 防 shell injection：白名单 regex 严格匹配整条命令字符串，不允许任意拼接。
 * 但仍然要在 child_process 那边用 `shell: false` + args 数组（更安全），
 * 或者承认 shell:true 风险但每条命令显式 approval。
 */

/**
 * 安全只读命令 patterns —— 整条命令必须匹配其中一个（开头 + 结尾锚定）。
 *
 * 故意保守：不放 `git status -uall`（含 -u 参数后面接路径，可能写入）等；
 * 不放 `find` （-exec 可执行任意命令）；不放 `xargs`（同样）。
 * 通配符 `\S+` 仅允许非空白单 token，防止 ` ; rm -rf ~/` 这种 injection。
 */
const SAFE_REGEX: RegExp[] = [
  /^pwd$/,
  /^whoami$/,
  /^hostname$/,
  /^date(\s+\+[%a-zA-Z:/_-]+)?$/,
  /^uname(\s+-[arsmnp])?$/,
  /^ls(\s+-[1aAhltrSF]+)?(\s+\S+)?$/,
  /^cat\s+\S+$/,
  /^head(\s+-n\s+\d+)?\s+\S+$/,
  /^tail(\s+-n\s+\d+)?\s+\S+$/,
  /^wc(\s+-[lwc]+)?\s+\S+$/,
  /^file\s+\S+$/,
  /^stat\s+\S+$/,
  /^which\s+\S+$/,
  /^type\s+\S+$/,
  /^echo(\s+\S+){0,5}$/,
  /^df(\s+-h)?$/,
  /^du(\s+-[hsd]+)?(\s+\S+)?$/,
  /^free(\s+-h)?$/, // Linux only but 跨平台无害
  /^ps(\s+-[aux]+)?$/,
  /^top\s+-l\s+1$/, // 单 snapshot
  /^uptime$/,
  // Git read-only
  /^git\s+status$/,
  /^git\s+log(\s+--?\S+)*(\s+-\d+)?$/,
  /^git\s+diff(\s+--?\S+)*(\s+\S+)?$/,
  /^git\s+branch(\s+--?\S+)*$/,
  /^git\s+remote(\s+-v)?$/,
  /^git\s+show(\s+--?\S+)*(\s+\S+)?$/,
  /^git\s+config\s+--get\s+\S+$/,
  /^git\s+rev-parse(\s+--?\S+)*\s+\S+$/,
  // Package managers read-only
  /^brew\s+(list|info|search|--version)(\s+\S+)?$/,
  /^npm\s+(list|view|version|outdated)(\s+--?\S+)*(\s+\S+)?$/,
  /^pip\s+(list|show|freeze)(\s+\S+)?$/,
  /^node\s+--version$/,
  /^python3?\s+--version$/,
  /^ruby\s+--version$/,
  /^go\s+version$/
]

/**
 * 永久拒绝 patterns —— 即使用户 approval 也拒绝。
 *
 * 这些 patterns 表示"非常危险" —— 写入路径未知、网络下载执行、提权、设备 IO 等。
 * 不允许用户解锁是为了防 social engineering（AI 用花言巧语劝用户允许）。
 */
const HARD_DENY_REGEX: RegExp[] = [
  /\bsudo\b/,
  /\bdoas\b/,
  /\bsu\s/,
  /\bcurl\s+[^|]*\|\s*(sh|bash|zsh)/, // curl | sh
  /\bwget\s+[^|]*\|\s*(sh|bash|zsh)/,
  /\bdd\b/,
  /\bmkfs\b/,
  /\bfdisk\b/,
  /\bdiskutil\s+(erase|partition)/,
  />\s*\/dev\/(disk|sd|hd|nvme)/, // 写 raw device
  /\bchown\s+(-R\s+)?root/,
  /\bchmod\s+(-R\s+)?(\+s|\d*[0-7]*[1-7][0-7]{2}[1-7])/, // setuid 之类
  /\b(launchctl|systemctl)\s+(load|enable|start|disable|unload|stop)\s/, // 服务操控
  /\bpkill\b/,
  /\bkillall\b/,
  /\bnetwork\s*setup\b/i,
  /\b(scp|rsync)\s+[^|]*@/, // 外发数据
  /\beval\s/, // 任意代码执行
  /\bexec\s/
]

/**
 * 灾难性 rm 检测 (替代老的 3 条 rm 正则) —— 老正则 `/\brm\s+-r?f?\s+.../` 强制 r 在 f 前、
 * 不认长选项, 实测 `rm -fr /` / `rm -r -f /` / `rm --recursive --force /` / `rm -rf /Users/han`
 * 全部绕过跌到 needs-approval, 用户被劝一下点允许就执行. 改成 tokenize 后按语义判:
 * 只要是 rm 且任一目标指向**整盘根 / 家目录根 / 系统关键目录**, 无论 flag 形态一律 HARD_DENY.
 * 删子目录 (如 ~/Documents/foo) 不在此列, 仍走 needs-approval 让用户决定.
 */
function isCatastrophicTarget(token: string): boolean {
  // 去尾随斜杠 (但保留根 '/' 本身)
  const p = token.length > 1 ? token.replace(/\/+$/, '') : token
  if (p === '/' || p === '~' || p === '$HOME' || p === '${HOME}' || p === '.') return true
  // 家目录根 (只一层 → 删整个用户家目录): /Users/<name> 或 /home/<name>
  if (/^\/(Users|home)\/[^/]+$/.test(p)) return true
  // 系统关键根
  if (/^\/(System|Library|usr|bin|sbin|etc|var|opt|private|Applications)$/.test(p)) return true
  return false
}

function isCatastrophicRm(cmd: string): boolean {
  const tokens = cmd.trim().split(/\s+/)
  // 允许带路径前缀 (/bin/rm) 或纯 rm; 第一个匹配的 rm token 之后的非 flag 都算目标
  const idx = tokens.findIndex((t) => t === 'rm' || t.endsWith('/rm'))
  if (idx === -1) return false
  const targets = tokens.slice(idx + 1).filter((t) => !t.startsWith('-'))
  return targets.some(isCatastrophicTarget)
}

export interface CommandCheck {
  /** 'safe' = 白名单免 modal；'deny' = 硬拒；'needs-approval' = 弹 modal */
  level: 'safe' | 'deny' | 'needs-approval'
  reason?: string
  matched?: string
}

/**
 * Shell metachar 黑名单（M4-C-fix B1）—— safe path 看到这些字符必须降级到 needs-approval。
 * 包括命令替换、subshell、管道、重定向、变量展开、glob 等所有让 shell 在表面字符之外
 * 执行额外动作的 token。审计官 cr 已识别 `echo $TAVILY_API_KEY` / `cat \`...\`` 等绕过。
 */
const SHELL_METACHAR_REGEX = /[;|&`$(){}<>*?[\]"'\\]/

export function hasShellMetachars(cmd: string): boolean {
  return SHELL_METACHAR_REGEX.test(cmd)
}

export function checkCommand(rawCmd: string): CommandCheck {
  const cmd = rawCmd.trim()
  if (!cmd) return { level: 'deny', reason: 'empty command' }
  if (cmd.length > 2000) return { level: 'deny', reason: 'command too long (>2000 chars)' }
  // 防多行（subshell / heredoc）
  if (cmd.includes('\n')) return { level: 'deny', reason: 'multiline commands rejected' }

  // 硬拒: 灾难性 rm (tokenize 判, flag 顺序无关) + 其它危险 pattern
  if (isCatastrophicRm(cmd)) {
    return {
      level: 'deny',
      reason: '永久拒绝: rm 指向根/家目录/系统目录',
      matched: 'catastrophic-rm'
    }
  }
  for (const re of HARD_DENY_REGEX) {
    if (re.test(cmd)) {
      return { level: 'deny', reason: '永久拒绝的危险命令', matched: re.source }
    }
  }
  // 白名单
  for (const re of SAFE_REGEX) {
    if (re.test(cmd)) {
      // M4-C-fix B1：safe path 额外拒 shell metachar —— SAFE_REGEX 正则虽然窄，但
      // \S+ 参数允许 `cat \`...\`` / `echo $(...)` 这种把 shell 当后门的命令。
      // safe path 走 shell:false spawn，metachar 也不会被 shell 解释，但仍然拒绝以
      // 防 user/AI 误以为这种命令能执行（保护"安全 = 你看到的字面意思就是执行的"语义）。
      if (hasShellMetachars(cmd)) {
        return { level: 'needs-approval', reason: 'safe 命令但含 shell metachar，需用户确认' }
      }
      return { level: 'safe' }
    }
  }
  // 其它
  return { level: 'needs-approval' }
}

/**
 * 把 SAFE 命令 tokenize 成 argv（safe 已确保无 metachar，简单 whitespace split 足够）。
 * 用于 spawn shell:false 执行 —— 完全绕过 shell expand。
 */
export function tokenizeSafeCommand(cmd: string): string[] {
  return cmd
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0)
}
