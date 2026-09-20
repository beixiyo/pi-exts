/**
 * codex /wham/usage 响应解析契约测试
 *
 * 捕获的失败面：plus（5h+周双窗口）与 pro（仅周窗口）两种套餐形态的段展开、
 * 窗口标签映射、reset 倒计时段生成；响应结构变化或解析回归都会暴露
 */
import { describe, expect, it } from 'vitest'
import { parseUsageWindows } from './codex'

const NOW = 1_789_872_854_727

function window(used: number, seconds: number, resetAtSec: number) {
  return { used_percent: used, limit_window_seconds: seconds, reset_after_seconds: 60, reset_at: resetAtSec }
}

function payload(primary: unknown, secondary: unknown = null) {
  return { plan_type: 'pro', rate_limit: { allowed: true, primary_window: primary, secondary_window: secondary } }
}

describe('parseUsageWindows', () => {
  it('plus 形态：5h 主窗 + 周副窗 + 周重置段', () => {
    const segs = parseUsageWindows(payload(window(12, 18_000, 1_789_900_000), window(30, 604_800, 1_793_000_000)), NOW)
    expect(segs.map((s) => s.text)).toEqual(['5h 12% used', 'wk 30% used', '5h reset 7h32m'])
    expect(segs[2].pct).toBeNull()
  })

  it('pro 形态：primary 即周窗口，单用量段 + 周重置段', () => {
    const segs = parseUsageWindows(payload(window(1, 604_800, 1_790_412_349)), NOW)
    expect(segs.map((s) => s.text)).toEqual(['wk 1% used', 'wk reset 6d5h'])
  })

  it('未知窗口长度按小时数展示', () => {
    const segs = parseUsageWindows(payload(window(50, 3_600, NOW / 1000 + 600)), NOW)
    expect(segs[0]?.text).toBe('1h 50% used')
  })

  it('空窗口 / 畸形响应返回空数组（footer 少一段，不抛错）', () => {
    expect(parseUsageWindows(payload(null), NOW)).toEqual([])
    expect(parseUsageWindows({ rate_limit: null }, NOW)).toEqual([])
    expect(parseUsageWindows('garbage', NOW)).toEqual([])
  })

  it('used_percent 缺失的窗口被跳过', () => {
    const segs = parseUsageWindows(payload({ limit_window_seconds: 604_800, reset_at: NOW / 1000 }, null), NOW)
    expect(segs).toEqual([])
  })
})
