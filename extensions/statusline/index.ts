/**
 * Statusline — 声明式配置的彩色 footer（色板参照 tokyonight-pretty_cat.vim）
 *
 * 装配层：配额后台刷新、输入框徽标挂载、footer 组装
 * 配置与默认值见 ./config.ts，颜色见 ./colors.ts，徽标见 ./badge.ts，
 * 段落取数见 ./segments.ts，单行渲染见 ./render.ts
 *
 * 配额数据由 lib/quota 各厂商 adapter 提供（GLM Coding Plan / OpenRouter /
 * DeepSeek / OpenAI），凭证只读 auth.json 与环境变量
 *
 * 输入框徽标通过 getEditorComponent() 装饰现有编辑器（如 pi-vim 的
 * ModalEditor）而非替换，vim 功能不受影响
 *
 * 仅 TUI 模式启用；启动时和每轮结束后刷新配额（节流静默）；配额只拉当前
 * 模型 provider 的厂商，切换模型立即重拉重绘（间隙不显示旧厂商段）
 * 调试：STATUSLINE_DEBUG=1 启动 pi，非法配置项写入 /tmp/statusline-debug.log
 */
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { CustomEditor } from '@earendil-works/pi-coding-agent'
import { fetchQuotas, type QuotaSegment } from '../../lib/quota'
import { SessionBadgeEditor } from './badge'
import { CONFIG } from './config'
import { createRender } from './render'
import { createLeftTexts, createRightTexts } from './segments'

export default function(pi: ExtensionAPI) {
  let quota: QuotaSegment[] = []
  let requestRender: (() => void) | undefined
  let lastFetch = 0
  let fetching = false
  /** 当前会话上下文（session_start 后可用），refreshQuota 读它的 model.provider */
  let currentCtx: ExtensionContext | undefined

  async function refreshQuota(force = false): Promise<void> {
    if (fetching || (!force && Date.now() - lastFetch < CONFIG.quotaRefreshMs)) return
    const provider = currentCtx?.model?.provider
    if (!provider) return
    fetching = true
    lastFetch = Date.now()
    try {
      quota = await fetchQuotas(provider)
    }
    catch {
      // 静默：保留上次结果，下一轮再试
    }
    finally {
      fetching = false
      requestRender?.()
    }
  }

  pi.on('session_start', async (_event, ctx) => {
    if (ctx.mode !== 'tui') return
    currentCtx = ctx
    void refreshQuota()

    // 输入框徽标：延迟一拍包装。局部扩展先于 package（pi-vim 等）初始化，
    // 立即读 getEditorComponent() 会拿到 undefined 且随后被 package 覆盖；
    // setTimeout(0) 等全部同步 session_start 跑完后再装饰现有编辑器
    if (CONFIG.badge.enabled) {
      setTimeout(() => {
        const existing = ctx.ui.getEditorComponent()
        const base = existing ?? ((tui, theme, kb) => new CustomEditor(tui, theme, kb))
        ctx.ui.setEditorComponent((tui, theme, kb) => new SessionBadgeEditor(base(tui, theme, kb), () => ctx.sessionManager.getSessionName()))
      }, 0)
    }

    ctx.ui.setFooter((tui, theme, footerData) => {
      requestRender = () => tui.requestRender()
      // 分支切换主动重绘；dispose 由 TUI 在替换/关闭 footer 时调用
      const dispose = footerData.onBranchChange(() => tui.requestRender())

      const leftTexts = createLeftTexts(ctx, footerData)
      const rightTexts = createRightTexts(ctx, () => quota)
      const render = createRender(theme, leftTexts, rightTexts)

      return { render, invalidate() {}, dispose }
    })
  })

  // 每轮结束后配额已变化，刷新一次（内部节流）
  pi.on('turn_end', () => {
    void refreshQuota()
  })

  // 切换模型：改拉新 provider 的配额（绕过节流）；渲染层过滤保证间隙不显示旧厂商段
  pi.on('model_select', () => {
    void refreshQuota(true)
  })
}
