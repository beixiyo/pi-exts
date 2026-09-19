/**
 * Markdown inline code background — opencode style
 *
 * pi 主题没有 markdown 元素级背景 token，这里通过官方 registerMarkdownTransformer
 * 在解析前把 `code` 替换为「自定义前景 + 自定义背景」的 ANSI 串（渲染管线透传）
 * fenced 代码块内容不动（语法高亮管线接管，注入会被覆盖）
 *
 * 依赖 ANSI 透传这一未文档化行为，pi 版本更新后若失效直接删除本文件即可
 *
 * ## 配置（settings.json 的 mdCodeBg 键，整段可省略）
 *   {
 *     "mdCodeBg": {
 *       "enabled": true,       // false 时不注册 transformer
 *       "fg": "#42b3c2",       // 前景色（#RRGGBB）
 *       "bg": "#313244"        // 背景色（#RRGGBB）
 *     }
 *   }
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { readExtensionConfig } from '../lib/settings'

/** hex → 「\x1b[38;2;R;G;Bm」/「\x1b[48;2;R;G;Bm」前景/背景转义 */
function rgb(hex: string, bg: boolean): string | undefined {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return undefined
  const v = m[1]!
  const parts = [Number.parseInt(v.slice(0, 2), 16), Number.parseInt(v.slice(2, 4), 16), Number.parseInt(v.slice(4, 6), 16)]
  return `\x1b[${bg ? 48 : 38};2;${parts[0]};${parts[1]};${parts[2]}m`
}

/** 配置归一化：非法色回退默认 */
function loadConfig(): { enabled: boolean; fg: string; bg: string } {
  const cfg = readExtensionConfig('mdCodeBg')
  const fg = typeof cfg?.fg === 'string' ? rgb(cfg.fg, false) : undefined
  const bg = typeof cfg?.bg === 'string' ? rgb(cfg.bg, true) : undefined
  return {
    enabled: cfg?.enabled !== false,
    fg: fg ?? '\x1b[38;2;66;179;194m',
    bg: bg ?? '\x1b[48;2;49;50;68m',
  }
}

const RESET = '\x1b[39m\x1b[49m'

export default function(pi: ExtensionAPI) {
  const { enabled, fg, bg } = loadConfig()
  if (!enabled) return

  pi.registerMarkdownTransformer((markdown) =>
    markdown
      .split(/(```[\s\S]*?(?:```|$))/g)
      .map((part, i) =>
        i % 2 === 1
          ? part
          : part.replace(/`([^`\n]+)`/g, (_, code: string) => `${bg}${fg} ${code} ${RESET}`)
      )
      .join('')
  )
}
