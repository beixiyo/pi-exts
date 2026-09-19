/**
 * 配额聚合：按 auth.json 实际存在的凭证并行拉取各厂商配额段
 *
 * 凭证解析顺序：adapter.authKeys（auth.json providers，按序取第一个有 key 的）
 * → adapter.envKey 环境变量。任一厂商失败静默跳过（footer 少一段，不打扰）
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getAgentDir } from '../settings'
import { deepseekAdapter } from './deepseek'
import { openaiAdapter } from './openai'
import { openrouterAdapter } from './openrouter'
import type { ProviderAdapter, QuotaSegment } from './types'
import { zaiAdapter } from './zai'

/** 全部已启用的 adapter；新增厂商在此登记 */
export const ADAPTERS: readonly ProviderAdapter[] = [
  zaiAdapter,
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

/** 单个 adapter 的凭证解析：authKeys 按序 → envKey */
function resolveCredential(adapter: ProviderAdapter, providers: Record<string, unknown>): { key: string; authKey: string } | undefined {
  for (const name of adapter.authKeys) {
    const entry = providers[name]
    const key = entry && typeof entry === 'object' ? (entry as Record<string, unknown>).key : undefined
    if (typeof key === 'string' && key) return { key, authKey: name }
  }
  const env = adapter.envKey ? process.env[adapter.envKey] : undefined
  return env ? { key: env, authKey: adapter.authKeys[0] ?? env } : undefined
}

/** 并行拉取全部有凭证的厂商；单厂超时 5s、失败静默，返回扁平段列表 */
export async function fetchQuotas(): Promise<QuotaSegment[]> {
  const providers = readAuthProviders()
  const jobs = ADAPTERS
    .map((adapter) => ({ adapter, credential: resolveCredential(adapter, providers) }))
    .filter((job): job is { adapter: ProviderAdapter; credential: { key: string; authKey: string } } => job.credential !== undefined)
    .map(async ({ adapter, credential }) => {
      try {
        return await adapter.fetchQuota(credential.key, credential.authKey, AbortSignal.timeout(5_000))
      }
      catch {
        return []
      }
    })

  const results = await Promise.all(jobs)
  return results.flat()
}

export type { QuotaSegment } from './types'
