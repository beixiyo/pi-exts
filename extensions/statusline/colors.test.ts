/**
 * autoResolve 回归测试
 *
 * 捕获的失败面（已发生的真实缺陷）：normal 档曾是单一颜色，
 * 所有用量段同档位时全绿——段间无法区分
 * 若实现回退为单色 normal，本测试必红
 */
import { describe, expect, it } from 'vitest'
import { autoResolve } from './colors'
import { DEFAULTS, loadConfig } from './config'

const CFG = loadConfig({})

describe('autoResolve', () => {
  it('固定色（非 auto）原样返回', () => {
    expect(autoResolve(CFG, '#ff0000', 50, 3)).toBe('#ff0000')
    expect(autoResolve(CFG, 'text', null, 0)).toBe('text')
  })

  it('超 dangerAt 用统一 danger 色、超 warnAt 用统一 warn 色', () => {
    expect(autoResolve(CFG, 'auto', 95, 0)).toBe(DEFAULTS.autoLevels.danger)
    expect(autoResolve(CFG, 'auto', 75, 1)).toBe(DEFAULTS.autoLevels.warn)
  })

  it('normal 档按段序轮换色板（回归：曾是单一绿色）', () => {
    const palette = DEFAULTS.autoLevels.normal
    const first = autoResolve(CFG, 'auto', 10, 0)
    const second = autoResolve(CFG, 'auto', 10, 1)
    const third = autoResolve(CFG, 'auto', 10, 2)
    expect(first).not.toBe(second)
    expect(second).not.toBe(third)
    expect([first, second, third]).toEqual(palette.slice(0, 3))
  })

  it('无百分比（null/undefined）也走 normal 色板', () => {
    expect(autoResolve(CFG, 'auto', null, 1)).toBe(DEFAULTS.autoLevels.normal[1])
  })

  it('色板越界后循环取色', () => {
    const palette = DEFAULTS.autoLevels.normal
    expect(autoResolve(CFG, 'auto', 10, palette.length)).toBe(palette[0])
  })
})
