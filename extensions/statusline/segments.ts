/**
 * Statusline 段落取数：左侧固定段 + 右侧用量段的文本与百分比来源
 */
import type { ExtensionContext, ReadonlyFooterDataProvider } from '@earendil-works/pi-coding-agent'
import type { QuotaSegment } from '../../lib/quota'
import { CONFIG, type ContextStyle, type LeftSegmentType, type RightSegmentType, type StatuslineLabels } from './config'

/** 右侧用量段产物：显示文本 + 已用百分比（供 auto 变色） */
export interface RightSegmentPart {
  text: string
  pct: number | null
}

/** tokens 人类可读化：≥1M 用 M（≤10M 保留 1 位小数），≥1K 用整数 K，否则原值（已用/总量共用） */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000
    return `${m >= 10 ? Math.round(m) : Math.round(m * 10) / 10}M`
  }
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`
  return `${tokens}`
}

/** context 段文本：按 contextStyle 组装；tokens/percent 未知时退占位（labels 提供文案） */
export function contextText(
  style: ContextStyle,
  usage: { tokens: number | null; contextWindow: number; percent: number | null },
  labels: StatuslineLabels,
): string {
  const pct = usage.percent === null ? null : Math.round(usage.percent)
  const used = usage.tokens === null ? null : formatTokens(usage.tokens)
  const total = formatTokens(usage.contextWindow)

  switch (style) {
    case 'pct':
      return pct === null ? `${labels.ctx} ?` : `${labels.ctx} ${pct}% ${labels.used}`
    case 'pct-used':
      return pct === null || used === null ? `${labels.ctx} ?` : `${labels.ctx} ${pct}% ${used}`
    case 'pct-total':
      return pct === null ? `${labels.ctx} ?` : `${labels.ctx} ${pct}%/${total}`
    case 'used-total':
      return used === null ? `${labels.ctx} ?` : `${labels.ctx} ${used}/${total}`
  }
}

/** quota 段文本本地化：仅替换尾部「% used」后缀（文案属展示策略，lib/quota 保持英文契约）；
 * 非百分比形态（如 "OR $4.20"）原样返回 */
export function localizeQuotaText(text: string, used: string): string {
  return used === 'used' ? text : text.replace(/% used$/, `% ${used}`)
}

/** 构造左侧段取文本函数（extensionStatus 可产出多段），无数据返回空数组 */
export function createLeftTexts(ctx: ExtensionContext, footerData: ReadonlyFooterDataProvider): (type: LeftSegmentType) => string[] {
  return (type) => {
    switch (type) {
      case 'model':
        return [ctx.model?.name ?? ctx.model?.id ?? CONFIG.labels.noModel]
      case 'thinking':
        return [`${CONFIG.labels.thinking} ${ctx.thinkingLevel ?? 'off'}`]
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
        return [{ text: contextText(CONFIG.contextStyle, usage, CONFIG.labels), pct: usage.percent ?? null }]
      }
      case 'quota': {
        // 只显示当前模型 provider 的段；model 未就绪/切换间隙不显示旧厂商段
        const provider = ctx.model?.provider
        return provider
          ? getQuota()
            .filter((seg) => seg.provider === provider)
            .map((seg) => ({ text: localizeQuotaText(seg.text, CONFIG.labels.used), pct: seg.pct }))
          : []
      }
    }
  }
}
