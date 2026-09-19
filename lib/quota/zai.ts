/**
 * GLM Coding Plan（zai）配额 adapter
 *
 * 端点：GET {origin}/api/monitor/usage/quota/limit（Authorization 直接传 key）
 * 产出三段：5h 窗口、周窗口、周重置倒计时
 * 响应 unit 3 为 5h 窗口、unit 6 为周窗口；百分比优先，缺省由计数换算
 */
import type { ProviderAdapter, QuotaSegment } from './types'

interface QuotaWindow extends QuotaSegment {
  resetsAt?: number
}

const ORIGINS: Record<string, string> = {
  zai: 'https://api.z.ai',
  'zai-coding-cn': 'https://open.bigmodel.cn',
}

/** 剩余时间：142h → 5d22h / 3.2h → 3h12m / 40m → 40m */
function fmtDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h${minutes % 60}m`
  return `${Math.floor(hours / 24)}d${hours % 24}h`
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

/** 单窗口解析：优先响应自带百分比，缺省由计数（currentValue/usage）换算 */
function quotaWindow(prefix: string, limit: Record<string, unknown>): QuotaWindow | undefined {
  let pct = asNumber(limit.percentage)
  if (pct === undefined) {
    const used = asNumber(limit.currentValue)
    const total = asNumber(limit.usage)
    if (used !== undefined && total !== undefined && total > 0) pct = (used / total) * 100
  }
  if (pct === undefined) return undefined
  const resetsAt = asNumber(limit.nextResetTime)
  return { text: `${prefix} ${Math.round(pct)}% used`, pct, ...{ ...(resetsAt !== undefined ? { resetsAt } : {}) } }
}

export const zaiAdapter: ProviderAdapter = {
  authKeys: Object.keys(ORIGINS),
  async fetchQuota(key, authKey, signal) {
    const origin = ORIGINS[authKey] ?? ORIGINS.zai!
    const res = await fetch(`${origin}/api/monitor/usage/quota/limit`, {
      headers: { Authorization: key },
      signal,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const payload: unknown = await res.json()
    const data = asObject(asObject(payload)?.data)
    const segments: QuotaSegment[] = []
    let weeklyReset: number | undefined

    const limits = Array.isArray(data?.limits) ? data.limits : []
    for (const raw of limits) {
      const limit = asObject(raw)
      if (!limit) continue
      if (limit.type !== 'TOKENS_LIMIT' && limit.type !== 'CREDIT_LIMIT') continue
      if (limit.unit === 3) {
        const seg = quotaWindow('5h', limit)
        if (seg) segments.push(seg)
      }
      else if (limit.unit === 6) {
        const seg = quotaWindow('wk', limit)
        if (seg) {
          segments.push(seg)
          weeklyReset = seg.resetsAt
        }
      }
    }
    if (weeklyReset !== undefined) {
      segments.push({ text: `wk reset ${fmtDuration(weeklyReset - Date.now())}`, pct: null })
    }
    return segments
  },
}
