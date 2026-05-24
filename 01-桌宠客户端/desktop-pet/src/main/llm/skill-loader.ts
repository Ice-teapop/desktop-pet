/**
 * Skill loader —— B 架构: dev-curated .md skills 在 src/main/llm/skills/, 编译时由
 * Vite `?raw` 内联进 bundle. 没有 fs / runtime path lookup, 也不依赖文件系统在
 * prod 环境是否能找到 src/.
 *
 * 加 skill 流程:
 *   1. 在 ./skills/ 下放新 <name>.md (frontmatter: name / description / trigger?)
 *   2. 在本文件 SKILL_SOURCES 数组里 import + push 一行
 *   3. (自动) system prompt 注入 metadata + load_skill tool 看得到新 name
 */

// `?raw` import: Vite 把 .md 文件作字符串内联. 类型走 Vite 官方 *?raw 声明.
/// <reference types="vite/client" />

import pdfSummary from './skills/pdf-summary.md?raw'
import codeReview from './skills/code-review.md?raw'
import dailyBrief from './skills/daily-brief.md?raw'

const SKILL_SOURCES: string[] = [pdfSummary, codeReview, dailyBrief]

export interface SkillMeta {
  name: string
  description: string
  trigger?: string
}

export interface Skill extends SkillMeta {
  content: string
}

const SKILLS_MAP = new Map<string, Skill>()

function parseAndRegister(raw: string): void {
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!fmMatch) {
    console.warn('[skill-loader] skipping file without frontmatter')
    return
  }
  const [, fmRaw, body] = fmMatch
  const fm: Record<string, string> = {}
  for (const line of fmRaw.split('\n')) {
    const m = line.match(/^([a-z_]+):\s*(.+)$/i)
    if (m) fm[m[1].toLowerCase()] = m[2].trim()
  }
  if (!fm.name || !fm.description) {
    console.warn('[skill-loader] skill missing name or description, skipped')
    return
  }
  SKILLS_MAP.set(fm.name, {
    name: fm.name,
    description: fm.description,
    trigger: fm.trigger,
    content: body.trim()
  })
}

for (const raw of SKILL_SOURCES) parseAndRegister(raw)

/** Skill 列表 (注入到 system prompt 时用) */
export function getAllSkillsMetadata(): SkillMeta[] {
  return Array.from(SKILLS_MAP.values()).map(({ name, description, trigger }) => ({
    name,
    description,
    trigger
  }))
}

/** Skill 完整内容 (load_skill tool 调用时返回) */
export function getSkillContent(name: string): string | null {
  return SKILLS_MAP.get(name)?.content ?? null
}

/** Skill 名字数组 (load_skill zod enum 用) */
export function getSkillNames(): string[] {
  return Array.from(SKILLS_MAP.keys())
}
