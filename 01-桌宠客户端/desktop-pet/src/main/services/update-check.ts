/**
 * 检查 GitHub Releases 最新版本 — 仅"检查 + 通知", 不下载不自动安装.
 *
 * 为什么不接 electron-updater:
 *  - electron-updater 真自动 install 要 codesign (Phase 2 才做)
 *  - 我们只需"有新版了, 去 release 页"的通知, 30 行 fetch 够用
 *  - 省 ~2MB 依赖 + ~5 个 native module
 *
 * 行为:
 *  - GET api.github.com/repos/Ice-teapop/desktop-pet/releases/latest
 *  - 解析 tag_name (e.g. "v0.4.1") → 跟 app.getVersion() (e.g. "0.4.0") 比
 *  - 新版存在 → 返 { available: true, version, htmlUrl }
 *  - 已是最新 / 网络失败 / 解析失败 → 返 { available: false } (静默, 不打扰)
 *
 * 不做:
 *  - 不缓存 (一天一次的事, 网络费可忽略; 24h 重复也无害)
 *  - 不带 GH_TOKEN (公开 repo, 不限频; private 时要加)
 *  - 不写盘
 */

import { app } from 'electron'

const REPO = 'Ice-teapop/desktop-pet'
const TIMEOUT_MS = 8_000

export interface UpdateCheckResult {
  available: boolean
  /** 远端最新版本 (无 v 前缀, e.g. "0.4.1"). 仅 available=true 时有 */
  version?: string
  /** Release 页 URL — 用户点击跳去这里. 仅 available=true 时有 */
  htmlUrl?: string
}

/** 简单 semver 比较 — 只看 major.minor.patch, 忽略 pre-release. a > b → 1 / a < b → -1 / a == b → 0 */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((s) => parseInt(s, 10) || 0)
  const pb = b.split('.').map((s) => parseInt(s, 10) || 0)
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x !== y) return x > y ? 1 : -1
  }
  return 0
}

export async function checkForUpdate(): Promise<UpdateCheckResult> {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal
    })
    if (!r.ok) {
      console.warn(`[update-check] HTTP ${r.status}`)
      return { available: false }
    }
    const data = (await r.json()) as {
      tag_name?: string
      html_url?: string
      draft?: boolean
      prerelease?: boolean
    }
    if (data.draft || data.prerelease) {
      // 跳过 draft / pre-release (用户没主动加入 beta 频道)
      return { available: false }
    }
    const tag = data.tag_name?.replace(/^v/, '') ?? ''
    const current = app.getVersion()
    if (!tag) return { available: false }
    const cmp = compareVersions(tag, current)
    if (cmp > 0) {
      return {
        available: true,
        version: tag,
        htmlUrl: data.html_url ?? `https://github.com/${REPO}/releases/latest`
      }
    }
    return { available: false }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[update-check] failed:', msg)
    return { available: false }
  } finally {
    clearTimeout(t)
  }
}
