/**
 * Session Rename — 首轮自动命名 + /rename 手动命令
 *
 * - 首轮请求 settle 后，用首轮用户消息自动生成标题（已命名的会话永不覆盖）
 * - /rename <文字>  → 直接以参数命名
 * - /rename         → 从最近几轮对话重新生成标题
 *
 * 配置见 ./model.ts，标题生成见 ./title.ts
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { DEFAULT_MAX_LEN, readPiSettings } from './model'
import { debug, firstUserText, generateTitle, recentConversationText } from './title'

export default function(pi: ExtensionAPI) {
  /** 配置实时读取：改 settings.json 后 /reload 或下会话即生效，无需考虑缓存 */
  const maxLen = () => readPiSettings().autoRename?.maxLen ?? DEFAULT_MAX_LEN

  let named = false
  let inFlight = false

  pi.on('session_start', () => {
    named = false
  })

  /** 首轮 settle 后自动命名（只一次；已有名 / 生成失败则放弃，不重试）
   *
   * 注意：pi 的事件分发对 async handler 是 await 串行等待，若在此处直接
   * await 模型调用（3~8s）会阻塞事件管线；因此悬空执行（void），生成完
   * 成后再异步落盘。代价是 -p 短命进程可能来不及写入即退出（可接受） */
  pi.on('agent_settled', (_event, ctx) => {
    debug('settled: named=', named, 'name=', JSON.stringify(ctx.sessionManager.getSessionName()))
    if (named || inFlight) return
    if (ctx.sessionManager.getSessionName()) return
    const content = firstUserText(ctx)
    debug('firstUserText=', JSON.stringify(content.slice(0, 60)))
    if (!content) return

    named = true
    inFlight = true
    const sessionFile = ctx.sessionManager.getSessionFile()

    void generateTitle(ctx, content, maxLen())
      .then((title) => {
        inFlight = false
        // 生成期间换了 session 或已有名字 → 丢弃，避免改错会话
        if (!title) return
        if (ctx.sessionManager.getSessionFile() !== sessionFile) return
        if (ctx.sessionManager.getSessionName()) return
        try {
          pi.setSessionName(title)
          if (ctx.hasUI) ctx.ui.notify(`Session renamed: ${title}`, 'info')
        }
        catch { /* session 已销毁等：静默 */ }
      })
      .catch(() => {
        inFlight = false
      })
  })

  /** /rename <文字> 直接命名；/rename 无参数按最近对话重新生成 */
  pi.registerCommand('rename', {
    description: 'Rename session; without arguments, generate a title from the recent conversation',
    handler: async (args, ctx) => {
      const direct = args.trim()
      if (direct) {
        pi.setSessionName(direct)
        named = true
        if (ctx.hasUI) ctx.ui.notify(`Session renamed: ${direct}`, 'info')
        return
      }

      const content = recentConversationText(ctx)
      if (!content) {
        if (ctx.hasUI) ctx.ui.notify('No conversation yet; try /rename <title>', 'warning')
        return
      }

      if (ctx.hasUI) ctx.ui.notify('Generating title...', 'info')
      const title = await generateTitle(ctx, content, maxLen())
      if (!title) {
        if (ctx.hasUI) ctx.ui.notify('Failed to generate title', 'warning')
        return
      }

      pi.setSessionName(title)
      named = true
      if (ctx.hasUI) ctx.ui.notify(`Session renamed: ${title}`, 'info')
    },
  })
}
