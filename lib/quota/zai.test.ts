/**
 * zai /quota/limit 响应解析契约测试
 *
 * 捕获的失败面：服务端业务拒绝（HTTP 200 + success:false 信封，如 ZCode 迁移期的
 * 「当前用户不存在coding plan」）静默吞掉导致配额段消失无从排查（2026-10-18 实际故障）；
 * 以及双窗口段展开、百分比缺省由计数换算
 */
import { describe, expect, it } from 'vitest'
import { parseQuotaSegments } from './zai'

function limit(unit: number, pct?: number, used?: number, total?: number, reset?: number) {
  return {
    type: 'TOKENS_LIMIT',
    unit,
    ...(pct !== undefined ? { percentage: pct } : {}),
    ...(used !== undefined ? { currentValue: used } : {}),
    ...(total !== undefined ? { usage: total } : {}),
    ...(reset !== undefined ? { nextResetTime: reset } : {}),
  }
}

function payload(limits: unknown[]) {
  return { code: 200, msg: 'ok', success: true, data: { limits } }
}

describe('parseQuotaSegments', () => {
  it('双窗口 + 周重置段展开（2026-10-18 上游故障修复后的正常形态）', () => {
    const segs = parseQuotaSegments(payload([limit(3, 12, undefined, undefined, Date.now() + 5e7), limit(6, 30, undefined, undefined, Date.now() + 6e8)]))
    expect(segs.map((s) => s.text).slice(0, 2)).toEqual(['5h 12% used', 'wk 30% used'])
    expect(segs[2]?.text).toMatch(/^wk reset /)
    expect(segs[2]?.pct).toBeNull()
  })

  it('百分比缺失时由 currentValue/usage 换算', () => {
    const segs = parseQuotaSegments(payload([limit(3, undefined, 50, 200)]))
    expect(segs.map((s) => s.text)).toEqual(['5h 25% used'])
  })

  it('服务端业务拒绝抛错并携带 code+msg（回归：此前静默返回空段）', () => {
    // ZCode 迁移期真实响应（HTTP 200 + success:false）
    const rejected = { code: 500, msg: '当前用户不存在coding plan', success: false }
    expect(() => parseQuotaSegments(rejected)).toThrow(/code=500.*不存在coding plan/)
  })

  it('畸形响应容错返回空段（不抛错）', () => {
    expect(parseQuotaSegments('garbage')).toEqual([])
    expect(parseQuotaSegments({ data: null })).toEqual([])
    expect(parseQuotaSegments(payload([limit(3, undefined, 1, 0)]))).toEqual([])
  })
})
