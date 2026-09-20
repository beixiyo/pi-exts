/**
 * Statusline 单行渲染：左侧段落装配 + 右侧用量段（窄终端从尾部逐段丢弃）
 */
import type { Theme } from '@earendil-works/pi-coding-agent'
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'
import { autoResolve, colorize } from './colors'
import { CONFIG, type LeftSegmentType, type RightSegmentType } from './config'
import type { RightSegmentPart } from './segments'

/** 构造 footer 渲染函数
 * color 随段带出：auto 在 normal 档按展开后的段序轮换色板 */
export function createRender(
  theme: Theme,
  leftTexts: (type: LeftSegmentType) => string[],
  rightTexts: (type: RightSegmentType) => RightSegmentPart[],
): (width: number) => string[] {
  return (width: number): string[] => {
    // ── 左侧：遍历声明，无数据段跳过（左侧不允许 'auto'，index 固定 0 即可）──
    const leftParts = CONFIG.left.flatMap((seg) => leftTexts(seg.type).map((text) => colorize(theme, autoResolve(CONFIG, seg.color, null, 0), text)))
    const dot = colorize(theme, CONFIG.separator.color, CONFIG.separator.left)
    const left = ' ' + leftParts.join(dot)

    // ── 右侧：遍历声明（一声明可扩多段）；窄终端从尾部逐段丢弃 ──
    const parts = CONFIG.right.flatMap((seg) => rightTexts(seg.type).map((part) => ({ ...part, color: seg.color })))
    const segments = parts.map((part, index) => colorize(theme, autoResolve(CONFIG, part.color, part.pct, index), part.text))

    const gap = colorize(theme, CONFIG.separator.color, CONFIG.separator.right)
    const kept = [...segments]
    while (kept.length > 0) {
      const right = kept.join(gap)
      const pad = width - visibleWidth(left) - visibleWidth(right) - 1
      if (pad >= 1) return [left + ' '.repeat(pad) + right]
      kept.pop()
    }
    return [truncateToWidth(left, width, '')]
  }
}
