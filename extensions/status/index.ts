/**
 * Status — /status 查看当前会话的各项元信息，方便接力（resume / 移交）
 *
 * 在聊天记录中追加一张持久卡片（appendEntry + 自定义渲染，不进 LLM 上下文）
 * 卡片渲染见 ./card.ts，元信息采集见 ./collect.ts
 *
 * ## 配置（~/.pi/agent/settings.json 的 statusCard 键，可省略）
 *   {
 *     "statusCard": {
 *       "copyToClipboard": true    // /status 时是否自动复制纯文本到剪贴板
 *     }
 *   }
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { copyText } from '../../lib/clipboard'
import { readExtensionConfig } from '../../lib/settings'
import { renderStatusCard, type StatusData } from './card'
import { collectStatus } from './collect'

/** /status 时是否自动复制纯文本（settings.statusCard.copyToClipboard，缺省 true） */
function copyEnabled(): boolean {
  return readExtensionConfig('statusCard')?.copyToClipboard !== false
}

export default function(pi: ExtensionAPI) {
  pi.registerEntryRenderer('status-card', (entry, _opts, theme) => renderStatusCard(entry.data as StatusData, theme))

  pi.registerCommand('status', {
    description: 'Show session info (cwd, session file, resume command) and copy to clipboard for handoff',
    handler: async (_args, ctx) => {
      const data = await collectStatus(pi, ctx)

      // 默认复制（statusCard.copyToClipboard 可关），接力时直接粘贴即可；失败不阻断卡片展示
      if (copyEnabled()) {
        try {
          await copyText(data.plainText)
          if (ctx.hasUI) ctx.ui.notify('Session info copied to clipboard', 'info')
        }
        catch {
          if (ctx.hasUI) ctx.ui.notify('Copy failed (clipboard unavailable)', 'warning')
        }
      }

      if (ctx.hasUI) {
        pi.appendEntry('status-card', data)
      }
      else {
        ctx.ui.notify(data.plainText, 'info')
      }
    },
  })
}
