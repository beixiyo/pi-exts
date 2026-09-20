/**
 * md-code-bg 配置读取与归一化（非法色回退默认）
 */
import { readExtensionConfig } from '../../lib/settings'

export interface MdCodeBgConfig {
  enabled: boolean
  /** 前景 ANSI 转义（\x1b[38;2;R;G;Bm） */
  fg: string
  /** 背景 ANSI 转义（\x1b[48;2;R;G;Bm） */
  bg: string
}

/** hex → 「\x1b[38;2;R;G;Bm」/「\x1b[48;2;R;G;Bm」前景/背景转义 */
function rgb(hex: string, bg: boolean): string | undefined {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return undefined
  const v = m[1]!
  const parts = [Number.parseInt(v.slice(0, 2), 16), Number.parseInt(v.slice(2, 4), 16), Number.parseInt(v.slice(4, 6), 16)]
  return `\x1b[${bg ? 48 : 38};2;${parts[0]};${parts[1]};${parts[2]}m`
}

export function loadConfig(): MdCodeBgConfig {
  const cfg = readExtensionConfig('mdCodeBg')
  const fg = typeof cfg?.fg === 'string' ? rgb(cfg.fg, false) : undefined
  const bg = typeof cfg?.bg === 'string' ? rgb(cfg.bg, true) : undefined
  return {
    enabled: cfg?.enabled !== false,
    fg: fg ?? '\x1b[38;2;66;179;194m',
    bg: bg ?? '\x1b[48;2;49;50;68m',
  }
}
