/**
 * 各厂商 adapter 共用的响应解析小工具
 */

/** 有限非负数（NaN/负数/非 number 返回 undefined） */
export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

/** 非数组对象（null/原始值/数组返回 undefined） */
export function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/** 剩余时间：142h → 5d22h / 3.2h → 3h12m / 40m → 40m（与 zai/codex reset 段一致） */
export function fmtDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h${minutes % 60}m`
  return `${Math.floor(hours / 24)}d${hours % 24}h`
}
