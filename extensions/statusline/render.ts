/**
 * Statusline 渲染：主行（左侧段落 + 右侧用量段，窄终端从尾部逐段丢弃）
 * + 可选的扩展状态独立行（有状态才出现，主行始终独占）
 */
import type { Theme } from '@earendil-works/pi-coding-agent'
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'
import { autoResolve, colorize } from './colors'
import { CONFIG, type LeftSegmentType, type RightSegmentType } from './config'
import type { RightSegmentPart } from './segments'

/** 构造 footer 渲染函数
 * color 随段带出：auto 在 normal 档按展开后的段序轮换色板；
 * statusTexts 取扩展状态独立行文本（空数组时不占行） */
export function createRender(
  theme: Theme,
  leftTexts: (type: LeftSegmentType) => string[],
  rightTexts: (type: RightSegmentType) => RightSegmentPart[],
  statusTexts: () => string[],
): (width: number) => string[] {
  return (width: number): string[] => {
    // ── 主行左侧：遍历声明，无数据段跳过（左侧不允许 'auto'，index 固定 0 即可）──
    const leftParts = CONFIG.left.flatMap((seg) => leftTexts(seg.type).map((text) => colorize(theme, autoResolve(CONFIG, seg.color, null, 0), text)))
    const dot = colorize(theme, CONFIG.separator.color, CONFIG.separator.left)
    const left = ' ' + leftParts.join(dot)

    // ── 主行右侧：遍历声明（一声明可扩多段）；窄终端从尾部逐段丢弃 ──
    const parts = CONFIG.right.flatMap((seg) => rightTexts(seg.type).map((part) => ({ ...part, color: seg.color })))
    const segments = parts.map((part, index) => colorize(theme, autoResolve(CONFIG, part.color, part.pct, index), part.text))

    const gap = colorize(theme, CONFIG.separator.color, CONFIG.separator.right)
    const kept = [...segments]
    let main: string | undefined
    while (kept.length > 0) {
      const right = kept.join(gap)
      const pad = width - visibleWidth(left) - visibleWidth(right) - 1
      if (pad >= 1) {
        main = left + ' '.repeat(pad) + right
        break
      }
      kept.pop()
    }
    main ??= truncateToWidth(left, width, '')

    // ── 扩展状态独立行：有状态才渲染，统一配色，不与主行互相挤压 ──
    if (CONFIG.statusRow.enabled) {
      const texts = statusTexts()
      if (texts.length > 0) {
        const line = colorize(theme, CONFIG.statusRow.color, ' ' + texts.join('  '))
        return [main, truncateToWidth(line, width, '…')]
      }
    }
    return [main]
  }
}
