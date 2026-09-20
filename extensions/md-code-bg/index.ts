/**
 * Markdown 行内代码背景色块
 *
 * pi 主题没有 markdown 元素级背景 token，这里通过官方 registerMarkdownTransformer
 * 在解析前把 `code` 替换为「自定义前景 + 自定义背景」的 ANSI 串（渲染管线透传）
 * fenced 代码块内容不动（语法高亮管线接管，注入会被覆盖）
 *
 * 依赖 ANSI 透传这一未文档化行为，pi 版本更新后若失效直接删除本扩展即可
 *
 * ## 配置（~/.pi/agent/settings.json 的 mdCodeBg 键，可省略）
 *   {
 *     "mdCodeBg": { "enabled": true, "fg": "#42b3c2", "bg": "#313244" }
 *   }
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { loadConfig } from './config'

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
