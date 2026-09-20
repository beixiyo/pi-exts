/**
 * Statusline 颜色工具：hex/主题色统一着色、'auto' 落档、徽标配色
 */
import type { Theme } from '@earendil-works/pi-coding-agent'
import { truncateToWidth } from '@earendil-works/pi-tui'
import { HEX_RE, type HexColor, type SegmentColor, type StatuslineConfig } from './config'

/** 'auto' 颜色解析：按用量百分比落档（warn/danger 统一警报色），
 * normal 档按段序在色板中轮换取色，保证同档位下段间可区分 */
export function autoResolve(cfg: StatuslineConfig, color: SegmentColor, pct: number | null | undefined, index: number): string {
  if (color !== 'auto') return color
  if (pct !== null && pct !== undefined) {
    if (pct >= cfg.autoLevels.dangerAt) return cfg.autoLevels.danger
    if (pct >= cfg.autoLevels.warnAt) return cfg.autoLevels.warn
  }
  const palette = cfg.autoLevels.normal
  return palette[index % palette.length]!
}

/** hex 色判定（类型谓词） */
function isHexColor(color: string): color is HexColor {
  return HEX_RE.test(color)
}

export function parseHex(hex: string): [number, number, number] | undefined {
  const match = HEX_RE.exec(hex)
  if (!match) return undefined
  const v = hex.slice(1)
  return [Number.parseInt(v.slice(0, 2), 16), Number.parseInt(v.slice(2, 4), 16), Number.parseInt(v.slice(4, 6), 16)]
}

/** xterm 216 色立方最近色索引 */
function cube256([r, g, b]: [number, number, number]): number {
  return 16 + 36 * Math.round((r / 255) * 5) + 6 * Math.round((g / 255) * 5) + Math.round((b / 255) * 5)
}

/** 统一着色：hex 走真彩（256 色终端降级最近色），其余走主题语义色 */
export function colorize(theme: Theme, color: string, text: string): string {
  if (isHexColor(color)) {
    const rgb = parseHex(color)
    if (!rgb) return theme.fg('text', text) // 非法 hex 容错：回退主题主色
    return theme.getColorMode() === 'truecolor'
      ? `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m${text}\x1b[39m`
      : `\x1b[38;5;${cube256(rgb)}m${text}\x1b[39m`
  }
  try {
    return theme.fg(color as Parameters<Theme['fg']>[0], text)
  }
  catch {
    return theme.fg('text', text) // 未知主题色名容错
  }
}

/** 按背景亮度自动取对比前景色（亮底 → 主题深色，暗底 → 亮灰） */
function autoBadgeFg(bg: HexColor): HexColor {
  const rgb = parseHex(bg)
  const lum = rgb ? (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255 : 0
  return lum > 0.45 ? '#1e1e2e' : '#c2c2c2'
}

/** 会话名背景色块标签：' 名称 '（前后各留一格底色）
 * 编辑器 factory 只提供 EditorTheme（无颜色模式），改按 COLORTERM 检测；
 * 检测不到时保守输出 256 色索引（truecolor 终端也兼容） */
const TRUECOLOR = /truecolor|24bit/i.test(process.env.COLORTERM ?? '')

/** 徽标最长显示宽度（列），含前后底色空格，名称部分占 maxWidth - 2 */
export function badgeLabel(name: string, cfg: StatuslineConfig, maxWidth: number): string {
  const text = ` ${truncateToWidth(name, Math.max(1, maxWidth - 2), '…')} `
  const bg = parseHex(cfg.badge.bg)
  const fg = parseHex(cfg.badge.fg ?? autoBadgeFg(cfg.badge.bg))
  if (!bg || !fg) return text
  if (TRUECOLOR) {
    return `\x1b[48;2;${bg[0]};${bg[1]};${bg[2]}m\x1b[38;2;${fg[0]};${fg[1]};${fg[2]}m${text}\x1b[39m\x1b[49m`
  }
  return `\x1b[48;5;${cube256(bg)}m\x1b[38;5;${cube256(fg)}m${text}\x1b[39m\x1b[49m`
}
