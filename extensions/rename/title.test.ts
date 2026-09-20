/**
 * cleanTitle 契约测试
 *
 * 捕获的失败面：模型输出带引号/围栏/句尾标点/超长 → 会话列表显示脏标题
 */
import { describe, expect, it } from 'vitest'
import { cleanTitle } from './title'

describe('cleanTitle', () => {
  it('剥首尾引号与围栏', () => {
    expect(cleanTitle('"Fix login bug"', 24)).toBe('Fix login bug')
    expect(cleanTitle('「修复登录」', 24)).toBe('修复登录')
    expect(cleanTitle('```ts\nFix bug\n```', 24)).toBe('Fix bug')
  })

  it('剥中英文句尾标点、压缩空白', () => {
    expect(cleanTitle('Fix it.', 24)).toBe('Fix it')
    expect(cleanTitle('修好了。', 24)).toBe('修好了')
    expect(cleanTitle('a   b', 24)).toBe('a b')
  })

  it('超长截断优先保词边界（英文）', () => {
    const out = cleanTitle('implement statusline segment palette', 20)
    expect(out.length).toBeLessThanOrEqual(20)
    expect(out).not.toMatch(/\s$/) // 截断后不留尾随空格
  })

  it('中文硬截断不受词边界影响', () => {
    const out = cleanTitle('这是一个非常非常长的中文标题用于测试截断行为', 8)
    expect(out.length).toBeLessThanOrEqual(8)
  })
})
