/**
 * 文件路径安全 —— M4-C
 *
 * 三层防御：
 *  1. **黑名单**（硬拦截，不能 trust）：~/.ssh、~/.aws、~/.gnupg、Keychain、
 *     浏览器数据目录、shell history、.env 等。AI 永远读不到 / 写不到。
 *  2. **系统目录黑名单**：/etc、/var、/usr/local/etc 等
 *  3. **trust set**（用户 approval 升级）：session-only 或 persistent，
 *     由 approval.ts 维护。本模块只提供 isPathSafe 的 Layer 1+2 检查。
 */
import { homedir } from 'os'
import { resolve, normalize } from 'path'

const HOME = homedir()

/** 相对 $HOME 的危险路径（绝对路径 = HOME + pattern）—— 永远不允许 */
const HOME_RELATIVE_BLACKLIST: RegExp[] = [
  /^\.ssh(\/|$)/, // SSH keys + known_hosts
  /^\.aws(\/|$)/, // AWS credentials
  /^\.gnupg(\/|$)/, // GPG keys
  /^\.docker\/config\.json$/, // Docker registry credentials
  /^\.netrc$/, // 老式 HTTP auth
  /^\.npmrc$/, // 含 _authToken 可能
  /^\.pypirc$/, // PyPI 上传 token
  /^\.bash_history$/, // shell 历史含命令 + 偶尔 secrets
  /^\.zsh_history$/,
  /^\.fish_history$/,
  /^\.psql_history$/,
  /^\.mysql_history$/,
  /^\.lesshst$/,
  /^Library\/Keychains(\/|$)/, // macOS Keychain
  /^Library\/Cookies(\/|$)/, // Safari cookies
  /^Library\/Application Support\/Google\/Chrome(\/|$)/,
  /^Library\/Application Support\/Firefox(\/|$)/,
  /^Library\/Application Support\/iStat Menus(\/|$)/, // 可能有 license
  /^Library\/Containers\/com\.apple\.Safari(\/|$)/,
  /^Library\/Safari(\/|$)/, // history.db
  /^Library\/Messages(\/|$)/, // iMessage db
  /^Library\/Mail(\/|$)/,
  /^Library\/IdentityServices(\/|$)/,
  /^\.config\/gh\/hosts\.yml$/, // GitHub CLI token
  /^\.config\/git\/credentials$/, // Git credentials
  /^\.git-credentials$/,
  // .env 系列（常含 API key / secret）
  /(^|\/)\.env(\.[\w-]+)?$/
]

/** 绝对路径完全禁止（系统目录 / device / proc） */
const ABSOLUTE_BLACKLIST: RegExp[] = [
  /^\/etc(\/|$)/,
  /^\/private\/etc(\/|$)/,
  /^\/var(\/|$)/,
  /^\/private\/var(\/|$)/,
  /^\/dev(\/|$)/,
  /^\/usr\/local\/etc(\/|$)/,
  /^\/System(\/|$)/,
  /^\/Library\/Keychains(\/|$)/,
  /^\/Library\/Application Support\/com\.apple/, // 系统级
  /^\/tmp\/.+\.env/i,
  /^\/proc(\/|$)/,
  /^\/root(\/|$)/
]

/** 默认 trusted root 列表 —— modal 里"信任此目录"基线必须在这些下 */
export const DEFAULT_TRUSTED_ROOTS: string[] = [
  `${HOME}/Documents`,
  `${HOME}/Downloads`,
  `${HOME}/Desktop`,
  `${HOME}/Movies`,
  `${HOME}/Music`,
  `${HOME}/Pictures`,
  `${HOME}/Public`,
  `${HOME}/Projects`, // 常见
  `${HOME}/dev`,
  `${HOME}/code`,
  `${HOME}/src`
]

export interface PathSafetyResult {
  ok: boolean
  /** 标准化后的绝对路径 */
  absPath: string
  /** 拒绝原因（人类可读） */
  reason?: string
  /** 命中的黑名单 pattern（debug 用） */
  matched?: string
}

/**
 * Layer 1+2 静态黑名单检查。返回 ok=false 表示"硬拦截，approval 也不能放行"。
 *
 * 注意：调用方拿到 ok=false 后应直接 tool_result is_error，不要 ask user。
 */
export function isPathSafe(rawPath: string): PathSafetyResult {
  if (typeof rawPath !== 'string' || !rawPath.trim()) {
    return { ok: false, absPath: '', reason: 'empty path' }
  }
  // 解析 ~ + 相对路径 → 绝对路径
  const expanded = rawPath.startsWith('~/')
    ? rawPath.replace(/^~/, HOME)
    : rawPath === '~'
      ? HOME
      : rawPath
  const absPath = normalize(resolve(expanded))

  // 黑名单 1：绝对路径系统目录
  for (const re of ABSOLUTE_BLACKLIST) {
    if (re.test(absPath)) {
      return {
        ok: false,
        absPath,
        reason: '系统目录禁止访问',
        matched: re.source
      }
    }
  }

  // 黑名单 2：HOME 相对的敏感文件
  if (absPath.startsWith(HOME + '/')) {
    const rel = absPath.slice(HOME.length + 1)
    for (const re of HOME_RELATIVE_BLACKLIST) {
      if (re.test(rel)) {
        return {
          ok: false,
          absPath,
          reason: '敏感目录/文件禁止访问（凭证、历史、浏览器数据等）',
          matched: re.source
        }
      }
    }
  }

  return { ok: true, absPath }
}

/** 给定一个绝对路径，返回其所属目录（用于"信任此目录"按钮）。 */
export function dirnameOf(absPath: string): string {
  const idx = absPath.lastIndexOf('/')
  return idx <= 0 ? '/' : absPath.slice(0, idx)
}

/**
 * 默认信任范围（M4-C-4 放宽）：HOME 下顶级非 hidden 非 Library 目录全部默认信任。
 *
 * 例：
 *   ~/Documents/notes/x.md        → true（visible top-level）
 *   ~/Projects/foo/bar.ts         → true
 *   ~/Library/Preferences/        → false（top-level=Library）
 *   ~/.config/git/config          → false（top-level=.config）
 *   /etc/hosts                    → false（不在 HOME）
 *
 * 必须先过 isPathSafe（黑名单仍硬拦 —— .ssh 等即使在 visible scope 也禁）。
 */
const HIDDEN_OR_LIBRARY = /^(\.|Library$)/

export function isInDefaultTrustedScope(absPath: string): boolean {
  if (!absPath.startsWith(HOME + '/')) return false
  const rel = absPath.slice(HOME.length + 1)
  if (!rel) return false
  const topSeg = rel.split('/')[0]
  return !HIDDEN_OR_LIBRARY.test(topSeg)
}
