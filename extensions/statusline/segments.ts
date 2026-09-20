/**
 * Statusline 段落取数：左侧固定段 + 右侧用量段的文本与百分比来源
 */
import type { ExtensionContext, ReadonlyFooterDataProvider } from '@earendil-works/pi-coding-agent'
import type { QuotaSegment } from '../../lib/quota'
import { CONFIG, type LeftSegmentType, type RightSegmentType } from './config'

/** 右侧用量段产物：显示文本 + 已用百分比（供 auto 变色） */
export interface RightSegmentPart {
  text: string
  pct: number | null
}

/** 构造左侧段取文本函数（extensionStatus 可产出多段），无数据返回空数组 */
export function createLeftTexts(ctx: ExtensionContext, footerData: ReadonlyFooterDataProvider): (type: LeftSegmentType) => string[] {
  return (type) => {
    switch (type) {
      case 'model':
        return [ctx.model?.name ?? ctx.model?.id ?? 'no-model']
      case 'thinking':
        return [`thinking ${ctx.thinkingLevel ?? 'off'}`]
      case 'branch': {
        const branch = footerData.getGitBranch()
        return branch ? [branch] : []
      }
      case 'sessionName': {
        const name = ctx.sessionManager.getSessionName()
        return name ? [name] : []
      }
      case 'extensionStatus':
        return [...footerData.getExtensionStatuses()]
          .filter(([key]) => !CONFIG.hiddenStatusKeys.includes(key))
          .map(([, status]) => status)
    }
  }
}

/** 构造右侧段取文本与用量百分比函数（可一扩多），无数据返回空数组
 * quota 通过 getter 读取：配额刷新会整体替换数组，闭包需看到最新引用 */
export function createRightTexts(ctx: ExtensionContext, getQuota: () => QuotaSegment[]): (type: RightSegmentType) => RightSegmentPart[] {
  return (type) => {
    switch (type) {
      case 'context': {
        const usage = ctx.getContextUsage()
        if (!usage) return []
        const pct = usage.percent
        return [{ text: pct === null ? 'ctx ?' : `ctx ${Math.round(pct)}% used`, pct: pct ?? null }]
      }
      case 'quota': {
        // 只显示当前模型 provider 的段；model 未就绪/切换间隙不显示旧厂商段
        const provider = ctx.model?.provider
        return provider
          ? getQuota().filter((seg) => seg.provider === provider).map((seg) => ({ text: seg.text, pct: seg.pct }))
          : []
      }
    }
  }
}
