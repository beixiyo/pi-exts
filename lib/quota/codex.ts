/**
 * OpenAI Codex 订阅（ChatGPT 登录）用量 adapter
 *
 * 端点：GET https://chatgpt.com/backend-api/wham/usage（与 codex CLI /status 同源）
 * 请求头：Authorization Bearer access token + ChatGPT-Account-Id + User-Agent codex-cli
 * 响应 rate_limit.primary_window / secondary_window 各含 used_percent、
 * limit_window_seconds（18000=5h、604800=周）与 reset_at（epoch 秒）；
 * plus 套餐 primary 为 5h 窗口 + secondary 周窗口，pro 套餐 primary 即周窗口
 *
 * 凭证：auth.json providers["openai-codex"] 的 OAuth access（pi 自动刷新写回）；
 * 临近过期（<1min）直接抛错静默跳过，避免拿死 token 打 401
 */
import { asNumber, asObject, fmtDuration } from './parse'
import type { ProviderAdapter, ProviderCredential, QuotaSegmentBase } from './types'

/** 窗口秒数 → 显示标签；未知长度按小时数展示 */
const WINDOW_LABELS: Record<number, string> = { 18_000: '5h', 604_800: 'wk' }

function windowLabel(seconds: number): string {
  return WINDOW_LABELS[seconds] ?? `${Math.max(1, Math.round(seconds / 3_600))}h`
}

/**
 * 解析 /wham/usage 响应为配额段：每个非空窗口一段用量 + 首个窗口的重置倒计时段
 * （纯函数，供 codex.test.ts 覆盖两种套餐形态）
 */
export function parseUsageWindows(payload: unknown, nowMs: number = Date.now()): QuotaSegmentBase[] {
  const limit = asObject(asObject(asObject(payload)?.rate_limit))
  const segments: QuotaSegmentBase[] = []
  let resetLabel: string | undefined
  let resetsAt: number | undefined

  for (const field of ['primary_window', 'secondary_window'] as const) {
    const win = asObject(limit?.[field])
    if (!win) continue
    const pct = asNumber(win.used_percent)
    const seconds = asNumber(win.limit_window_seconds)
    if (pct === undefined || seconds === undefined) continue

    const label = windowLabel(seconds)
    segments.push({ text: `${label} ${Math.round(pct)}% used`, pct })
    if (resetLabel === undefined) {
      const resetAtSec = asNumber(win.reset_at)
      if (resetAtSec !== undefined) {
        resetLabel = label
        resetsAt = resetAtSec * 1_000
      }
    }
  }

  if (resetLabel !== undefined && resetsAt !== undefined) {
    segments.push({ text: `${resetLabel} reset ${fmtDuration(resetsAt - nowMs)}`, pct: null, resetsAt })
  }
  return segments
}

export const codexAdapter: ProviderAdapter = {
  providers: ['openai-codex'],
  authKeys: ['openai-codex'],
  async fetchQuota({ key, accountId, expiresAt }: ProviderCredential, signal): Promise<QuotaSegmentBase[]> {
    if (expiresAt !== undefined && expiresAt < Date.now() + 60_000) throw new Error('access token expired')
    const headers: Record<string, string> = {
      Authorization: `Bearer ${key}`,
      'User-Agent': 'codex-cli',
      ...(accountId ? { 'ChatGPT-Account-Id': accountId } : {}),
    }
    const res = await fetch('https://chatgpt.com/backend-api/wham/usage', { headers, signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return parseUsageWindows(await res.json())
  },
}
