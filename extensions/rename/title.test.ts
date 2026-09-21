/**
 * cleanTitle 契约测试
 *
 * 捕获的失败面：模型输出带引号/围栏/句尾标点/超长 → 会话列表显示脏标题
 */
import { describe, expect, it } from 'vitest'
import { cleanTitle, looksLikeReply } from './title'

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

describe('looksLikeReply（回答式输出兕底）', () => {
  // 回归：2026-09-20 flowtica 会话真实坏标题 —— 小模型把首轮“你看看 xx 文档”当成对自己的请求，
  // 作答“我无法访问…”并被采用为 session 名；prompt 防线失效时此处必须拦截
  it('拦截真实坏标题（第一人称拒绝/无能开头）', () => {
    expect(looksLikeReply('我无法访问你本地文件系统里的文件，所以现在看不到')).toBe(true)
    expect(looksLikeReply('我读不到那个文件')).toBe(true)
    expect(looksLikeReply('I can\'t access your local files')).toBe(true)
    expect(looksLikeReply('Sorry, I cannot see the file')).toBe(true)
  })

  it('不误伤含“无法”的正常任务标题', () => {
    expect(looksLikeReply('修复无法登录问题')).toBe(false)
    expect(looksLikeReply('排查文件读取失败')).toBe(false)
    expect(looksLikeReply('Fix can\'t upload bug')).toBe(false)
  })
})
