/**
 * 配额聚合：按当前模型 provider 挑选 adapter，用 auth.json 实际存在的凭证
 * 拉取配额段，段统一标记 adapter 首个 provider id（供渲染层比对当前模型）
 *
 * 凭证解析顺序：adapter.authKeys（auth.json providers，按序取第一个有凭证的，
 * API key 或 OAuth access token）→ adapter.envKey 环境变量
 * 任一厂商失败静默跳过（footer 少一段，不打扰）
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getAgentDir } from '../settings'
import { codexAdapter } from './codex'
import { deepseekAdapter } from './deepseek'
import { openaiAdapter } from './openai'
import { openrouterAdapter } from './openrouter'
import { asObject } from './parse'
import type { ProviderAdapter, ProviderCredential, QuotaSegment } from './types'
import { zaiAdapter } from './zai'

/** 全部已启用的 adapter；新增厂商在此登记 */
export const ADAPTERS: readonly ProviderAdapter[] = [
  zaiAdapter,
  codexAdapter,
  openrouterAdapter,
  deepseekAdapter,
  openaiAdapter,
]

/** 读取 auth.json 的 providers 表（只读，不写回；无文件返回空表） */
function readAuthProviders(): Record<string, unknown> {
  try {
    const auth: unknown = JSON.parse(readFileSync(join(getAgentDir(), 'auth.json'), 'utf8'))
    return auth && typeof auth === 'object' ? (auth as Record<string, unknown>) : {}
  }
  catch {
    return {}
  }
}

/** 单个 adapter 的凭证解析：entry 的 key（API key）或 access（OAuth token）按序 → envKey */
function resolveCredential(adapter: ProviderAdapter, providers: Record<string, unknown>): ProviderCredential | undefined {
  for (const name of adapter.authKeys) {
    const entry = asObject(providers[name])
    if (!entry) continue
    const key = typeof entry.key === 'string' && entry.key
      ? entry.key
      : typeof entry.access === 'string' && entry.access
      ? entry.access
      : undefined
    if (!key) continue
    const accountId = typeof entry.accountId === 'string' && entry.accountId ? entry.accountId : undefined
    const expiresAt = typeof entry.expires === 'number' && entry.expires > 0 ? entry.expires : undefined
    return { key, authKey: name, ...(accountId ? { accountId } : {}), ...(expiresAt ? { expiresAt } : {}) }
  }
  const env = adapter.envKey ? process.env[adapter.envKey] : undefined
  return env ? { key: env, authKey: adapter.authKeys[0] ?? env } : undefined
}

/** 拉取配额段；provider 给定时只拉服务该 pi provider 的 adapter
 * （如 'openai-codex'），缺省拉全部有凭证厂商（供调试/脚本使用）
 * 单厂超时 5s、失败静默，返回扁平段列表 */
export async function fetchQuotas(provider?: string): Promise<QuotaSegment[]> {
  const adapters = provider !== undefined ? ADAPTERS.filter((a) => a.providers.includes(provider)) : ADAPTERS
  const providers = readAuthProviders()
  const jobs = adapters
    .map((adapter) => ({ adapter, credential: resolveCredential(adapter, providers) }))
    .filter((job): job is { adapter: ProviderAdapter; credential: ProviderCredential } => job.credential !== undefined)
    .map(async ({ adapter, credential }) => {
      try {
        const segs = await adapter.fetchQuota(credential, AbortSignal.timeout(5_000))
        return segs.map((seg) => ({ ...seg, provider: adapter.providers[0] ?? '' }))
      }
      catch {
        return []
      }
    })

  const results = await Promise.all(jobs)
  return results.flat()
}

export type { QuotaSegment } from './types'
