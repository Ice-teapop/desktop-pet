#!/usr/bin/env node
/**
 * SMIL → CSS sprite animation 转换器 (v0.5.0).
 *
 * 输入: Furina theme svg (含 <image> + <animateTransform>)
 * 输出: 同 SVG 但 <animateTransform> 被替换为 <style> CSS @keyframes
 *
 * 原理:
 *  - 解析 <image> width / viewBox width → 推算帧数 N = imageWidth / viewBoxWidth
 *  - 解析 <animateTransform> dur → CSS animation duration
 *  - SMIL ping-pong (forward + backward 共 2N-2 keyTimes, dur=fullCycle) →
 *    CSS half-dur + steps(N, jump-none) + alternate (浏览器自动反向)
 *  - GPU 提升: transform: translate3d() 让 chromium 把 image 提到 compositor 层
 *
 * 用法: node tools/smil-to-css.mjs <svg-file>           (单个文件 in-place 改)
 *      node tools/smil-to-css.mjs themes/X/svg/*.svg    (批量)
 */

import { readFileSync, writeFileSync } from 'fs'

function convertSvg(content) {
  // 1. 提 viewBox 宽
  const vbMatch = content.match(/viewBox="0 0 (\d+) (\d+)"/)
  if (!vbMatch) throw new Error('missing viewBox')
  const vbW = parseInt(vbMatch[1], 10)

  // 2. 提 image width (sprite sheet 宽)
  const imgMatch = content.match(/<image[^>]*width="(\d+)"/)
  if (!imgMatch) throw new Error('missing <image>')
  const imgW = parseInt(imgMatch[1], 10)

  // 3. 帧数
  const frames = imgW / vbW
  if (!Number.isInteger(frames)) {
    throw new Error(`frame count ${imgW}/${vbW} not integer`)
  }

  // 4. 提 SMIL dur (秒)
  const durMatch = content.match(/<animateTransform[^/]*dur="([0-9.]+)s?"/)
  if (!durMatch) throw new Error('missing <animateTransform>')
  const fullDur = parseFloat(durMatch[1])

  // 5. 是否 ping-pong? values 数 ≈ 2N-2 (forward+backward 共 72 for 37 frames)
  //    or = N (forward only)? 看 values 数判断.
  const valsMatch = content.match(/<animateTransform[^/]*values="([^"]+)"/)
  if (!valsMatch) throw new Error('missing values')
  const valsCount = valsMatch[1].split(';').length
  const isPingPong = valsCount > frames * 1.5 // forward only = N, ping-pong = ~2N
  const halfDur = isPingPong ? fullDur / 2 : fullDur
  // 取最后一帧 translate (= -(N-1) * vbW, 不是 -N*vbW)
  const maxTranslate = (frames - 1) * vbW

  // 6. 生成 CSS animation
  // 用 steps(N, jump-none) 让所有 N 帧都展示 (jump-none 给 N+1 stops 但有效 N 帧)
  const animName = `furina-scroll`
  const style = `<style>
    .strip-anim {
      animation: ${animName} ${halfDur}s steps(${frames}, jump-none) infinite ${isPingPong ? 'alternate' : ''};
      will-change: transform;
      transform: translate3d(0, 0, 0);
    }
    @keyframes ${animName} {
      from { transform: translate3d(0, 0, 0); }
      to { transform: translate3d(-${maxTranslate}px, 0, 0); }
    }
  </style>`

  // 7. 替换 <animateTransform> 元素为空, 删整段 (含 self-close /> 或 闭合 </animateTransform>)
  let out = content.replace(/<animateTransform\b[^/>]*\/>/, '')
  out = out.replace(/<animateTransform\b[^>]*>[\s\S]*?<\/animateTransform>/, '')

  // 8. 给 <image> 加 class="strip-anim"
  out = out.replace(/<image\b/, '<image class="strip-anim"')

  // 9. 在 <svg> 标签后注入 <style>
  out = out.replace(/(<svg\b[^>]*>)/, `$1\n${style}`)

  return { out, frames, halfDur, isPingPong }
}

// CLI
const files = process.argv.slice(2)
if (files.length === 0) {
  console.error('Usage: node smil-to-css.mjs <svg-file> [more-files...]')
  process.exit(1)
}
for (const file of files) {
  try {
    const content = readFileSync(file, 'utf8')
    const { out, frames, halfDur, isPingPong } = convertSvg(content)
    writeFileSync(file, out)
    console.log(
      `✓ ${file}: ${frames} frames, ${halfDur}s ${isPingPong ? 'ping-pong' : 'forward'} (full ${isPingPong ? halfDur * 2 : halfDur}s)`
    )
  } catch (err) {
    console.error(`✗ ${file}: ${err.message}`)
  }
}
