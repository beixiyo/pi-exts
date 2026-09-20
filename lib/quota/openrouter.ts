/**
 * OpenRouter 配额 adapter
 *
 * 端点：GET https://openrouter.ai/api/v1/credits（Bearer key）
 * 响应 { data: { total_credits, total_usage } }，剩余 = purchased - usage
 *
 * 注意：该接口需要 Management key（普通 provisioning key 返回 403），
 * 而调模型必须用普通 key —— 两者不能复用。凭证按序取：
 * auth.json providers["openrouter-credits"].key（手动添加的独立键）
 * → 环境变量 OPENROUTER_MANAGEMENT_KEY
 */
import type { ProviderAdapter, ProviderCredential, QuotaSegmentBase } from './types'

export const openrouterAdapter: ProviderAdapter = {
  providers: ['openrouter'],
  authKeys: ['openrouter-credits'],
  envKey: 'OPENROUTER_MANAGEMENT_KEY',
  async fetchQuota({ key }: ProviderCredential, signal): Promise<QuotaSegmentBase[]> {
    const res = await fetch('https://openrouter.ai/api/v1/credits', {
      headers: { Authorization: `Bearer ${key}` },
      signal,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const payload = (await res.json()) as { data?: { total_credits?: unknown; total_usage?: unknown } }
    const credits = Number(payload.data?.total_credits)
    const usage = Number(payload.data?.total_usage)
    if (!Number.isFinite(credits) || !Number.isFinite(usage) || credits <= 0) return []

    const remaining = credits - usage
    return [{ text: `OR $${remaining.toFixed(2)}`, pct: (usage / credits) * 100 }]
  },
}
