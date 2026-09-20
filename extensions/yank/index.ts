/**
 * /yank — 从会话历史中精确复制内容到剪贴板
 *
 * 输入 /yank 弹出选择器（旧→新排列，最新在底部，默认选中最新一项），
 * Tab 在三种模式间循环切换：
 *
 * - answers：每轮 assistant 回复一项；→ 展开其代码块为缩进子项，← 收起
 * - codes：全部回复中的代码块平铺（跨回答搜索块）
 * - questions：每轮用户消息一项
 *
 * - ↑↓ 移动、Enter 复制选中项、Esc 取消（SelectList 原生支持鼠标点击）
 * - 直接输入可打印字符 = 模糊过滤，Backspace 删除、C-u 清空
 * - 选中即复制原始内容，不增删任何字符（回答不含围栏，代码块不含首尾围栏行）
 *
 * 仅 TUI 模式；项数受配置约束，防止超长会话卡顿（见 ./config.ts）
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { copyText } from '../../lib/clipboard'
import { collectUnits } from './history'
import { pickUnit } from './picker'

export default function(pi: ExtensionAPI) {
  pi.registerCommand('yank', {
    description: 'Copy a reply, code block, or user question from the conversation',
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify('/yank requires TUI mode', 'warning')
        return
      }

      const units = collectUnits(ctx)
      if (units.length === 0) {
        ctx.ui.notify('Nothing to copy yet', 'warning')
        return
      }

      const chosen = await pickUnit(ctx, units)
      if (!chosen) return

      const what = chosen.kind === 'code'
        ? `${chosen.turnLabel} · code block ${chosen.lang || 'code'} · ${chosen.lineCount} lines`
        : `${chosen.turnLabel} · ${chosen.kind === 'question' ? 'question' : 'answer'} · ${chosen.lineCount} lines`
      try {
        await copyText(chosen.text)
        ctx.ui.notify(`Copied: ${what}`, 'info')
      }
      catch (err) {
        ctx.ui.notify(`Copy failed: ${err instanceof Error ? err.message : String(err)}`, 'error')
      }
    },
  })
}
