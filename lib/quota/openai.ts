/**
 * OpenAI 花费 adapter（可选）
 *
 * OpenAI 为后付费制：普通 API key 无任何计费查询能力，
 * 唯一路径是 Admin API（GET /v1/organization/costs，需 sk-admin- 开头的
 * Management key）。凭证按序取：
 * auth.json providers["openai-admin"].key（手动添加的独立键）
 * → 环境变量 OPENAI_ADMIN_KEY
 *
 * 产出本月（自然月）已花费；无凭证静默跳过
 */
import type { ProviderAdapter, ProviderCredential, QuotaSegmentBase } from './types'

export const openaiAdapter: ProviderAdapter = {
  providers: ['openai'],
  authKeys: ['openai-admin'],
  envKey: 'OPENAI_ADMIN_KEY',
  async fetchQuota({ key }: ProviderCredential, signal): Promise<QuotaSegmentBase[]> {
    const now = new Date()
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    const res = await fetch(
      `https://api.openai.com/v1/organization/costs?start_time=${Math.floor(start.getTime() / 1000)}&limit=31`,
      { headers: { Authorization: `Bearer ${key}` }, signal },
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const payload = (await res.json()) as { data?: Array<{ results?: Array<{ amount?: { value?: unknown } }> }> }
    let total = 0
    for (const bucket of payload.data ?? []) {
      for (const row of bucket.results ?? []) {
        const value = Number(row.amount?.value)
        if (Number.isFinite(value)) total += value
      }
    }
    return [{ text: `OA $${total.toFixed(2)} this mo`, pct: null }]
  },
}
