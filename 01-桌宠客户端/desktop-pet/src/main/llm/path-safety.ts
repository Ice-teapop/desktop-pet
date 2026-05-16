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
import { resolve, normalize, dirname, basename, join } from 'path'
import { promises as fs } from 'fs'

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
  // cr-fix: macOS /tmp 真身是 /private/tmp，两条都要拦；.env / .env.local 等都覆盖
  /^\/(private\/)?tmp\/.*\.env(\.|$)/i,
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

/** 内部：lexical 黑名单匹配（不解 symlink，给 realpath 前后两次复用）。 */
function checkBlacklist(absPath: string): PathSafetyResult {
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

/**
 * Layer 1+2 静态黑名单检查（async：因为要 realpath 解 symlink 防 trust-dir bypass）。
 *
 * 流程：
 *  1. 解析 ~ + normalize → lexical absPath
 *  2. lexical 黑名单匹配（早拒）
 *  3. fs.realpath 解析 symlink → canonical 路径
 *     - 文件不存在：realpath 父目录 + 重接 basename（处理 write_file 创建新文件场景）
 *     - 父目录也不存在：用 lexical absPath 当 canonical（create_directory recursive 走 OK）
 *  4. canonical 再过一次黑名单（这次抓 symlink 穿透）
 *
 * 返回 ok=false → 调用方直接 tool_result is_error，不要 ask user。
 * 返回的 absPath 是 **canonical 路径**（已解 symlink）—— 后续 trust 检查 / 实际 fs 操作都
 * 用这个，避免 TOCTOU race（先校验后读时 attacker 改 symlink）—— 但 realpath 跟 fs.read
 * 之间仍有 race window，要消除得用 openat 等 syscall（Node 不直接支持）。当前接受小 race，
 * 已经能挡 99% 静态 symlink 攻击。
 */
export async function isPathSafe(rawPath: string): Promise<PathSafetyResult> {
  if (typeof rawPath !== 'string' || !rawPath.trim()) {
    return { ok: false, absPath: '', reason: 'empty path' }
  }
  // 解析 ~ + 相对路径 → lexical 绝对路径
  const expanded = rawPath.startsWith('~/')
    ? rawPath.replace(/^~/, HOME)
    : rawPath === '~'
      ? HOME
      : rawPath
  const lexicalAbs = normalize(resolve(expanded))

  // 1. lexical 黑名单（早拒：直接写 `~/.ssh/id_rsa` 这种）
  const lexCheck = checkBlacklist(lexicalAbs)
  if (!lexCheck.ok) return lexCheck

  // 2. realpath 解 symlink 抓"~/Documents/notes → ~/.ssh" 类绕过
  let canonical: string
  try {
    canonical = await fs.realpath(lexicalAbs)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      // 路径不存在 —— 试着 realpath 父目录再拼 basename（write_file 创建新文件场景）
      try {
        const parentReal = await fs.realpath(dirname(lexicalAbs))
        canonical = join(parentReal, basename(lexicalAbs))
      } catch (err2) {
        // 父目录也不存在 —— recursive 创建场景，用 lexical 路径继续（无 symlink 可解）
        if ((err2 as NodeJS.ErrnoException).code === 'ENOENT') {
          canonical = lexicalAbs
        } else {
          return { ok: false, absPath: lexicalAbs, reason: 'cannot resolve parent dir' }
        }
      }
    } else {
      return { ok: false, absPath: lexicalAbs, reason: `realpath failed: ${code ?? 'unknown'}` }
    }
  }

  // 3. canonical 再过一次黑名单 —— 抓 symlink 穿透
  if (canonical !== lexicalAbs) {
    const canonCheck = checkBlacklist(canonical)
    if (!canonCheck.ok) {
      return {
        ...canonCheck,
        reason: `${canonCheck.reason}（path 通过 symlink 解析到此处）`
      }
    }
  }

  // 返回 canonical 路径（不是 lexical）—— 后续 trust check + fs op 都用 canonical
  return { ok: true, absPath: canonical }
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
