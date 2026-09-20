/**
 * DeepSeek 余额 adapter
 *
 * 端点：GET https://api.deepseek.com/user/balance（Bearer key，普通 API key 即可）
 * 响应 { is_available, balance_infos: [{ currency, total_balance, ... }] }；
 * 金额为字符串，预充值制无百分比/重置概念，多币种各成一段
 */
import type { ProviderAdapter, ProviderCredential, QuotaSegmentBase } from './types'

const SYMBOL: Record<string, string> = { CNY: '¥', USD: '$' }

export const deepseekAdapter: ProviderAdapter = {
  providers: ['deepseek'],
  authKeys: ['deepseek'],
  async fetchQuota({ key }: ProviderCredential, signal): Promise<QuotaSegmentBase[]> {
    const res = await fetch('https://api.deepseek.com/user/balance', {
      headers: { Authorization: `Bearer ${key}` },
      signal,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const payload = (await res.json()) as {
      balance_infos?: Array<{ currency?: unknown; total_balance?: unknown }>
    }
    const segments: QuotaSegmentBase[] = []
    for (const info of payload.balance_infos ?? []) {
      const total = Number(info.total_balance)
      if (!Number.isFinite(total)) continue
      const currency = typeof info.currency === 'string' ? info.currency : ''
      segments.push({ text: `DS ${SYMBOL[currency] ?? ''}${total.toFixed(2)}`, pct: null })
    }
    return segments
  },
}
