/**
 * statusline loadConfig 容错契约测试
 *
 * 捕获的失败面：README 承诺「非法值回退默认——写错配置不会弄坏状态栏」
 * 任意畸形输入都不得抛错，且结果各字段可安全使用
 */
import { describe, expect, it } from 'vitest'
import { DEFAULTS, loadConfig } from './config'

describe('loadConfig 容错', () => {
  it('空配置整体回退默认', () => {
    const cfg = loadConfig({})
    expect(cfg.left).toEqual(DEFAULTS.left)
    expect(cfg.right).toEqual(DEFAULTS.right)
    expect(cfg.quotaRefreshMs).toBe(DEFAULTS.quotaRefreshMs)
  })

  it('undefined 输入同样回退默认', () => {
    expect(loadConfig(undefined).separator).toEqual(DEFAULTS.separator)
  })

  it('未知段落类型与畸形段被丢弃，合法段保留', () => {
    const cfg = loadConfig({ left: [{ type: 'nope' }, 'garbage', { type: 'branch', color: '#123456' }, null] })
    expect(cfg.left).toEqual([{ type: 'branch', color: '#123456' }])
  })

  it('全非法段列表回退默认 left（不留空 footer）', () => {
    const cfg = loadConfig({ left: [{ type: 42 }] })
    expect(cfg.left).toEqual(DEFAULTS.left)
  })

  it('左侧 \'auto\' 降级为 \'text\'（仅用量段允许 auto）', () => {
    const cfg = loadConfig({ left: [{ type: 'model', color: 'auto' }] })
    expect(cfg.left[0]).toEqual({ type: 'model', color: 'text' })
  })

  it('autoLevels 非法阈值/颜色回退默认', () => {
    const cfg = loadConfig({ autoLevels: { warnAt: -1, dangerAt: 'high', normal: ['#bad', 42, '#4aa5f0'], warn: '', danger: null } })
    expect(cfg.autoLevels.warnAt).toBe(DEFAULTS.autoLevels.warnAt)
    expect(cfg.autoLevels.dangerAt).toBe(DEFAULTS.autoLevels.dangerAt)
    expect(cfg.autoLevels.normal).toEqual(['#4aa5f0']) // 只留合法 hex
    expect(cfg.autoLevels.warn).toBe(DEFAULTS.autoLevels.warn)
  })

  it('normal 接受单色字符串（等价单色板，向后兼容）', () => {
    const cfg = loadConfig({ autoLevels: { normal: '#6dc7a8' } })
    expect(cfg.autoLevels.normal).toEqual(['#6dc7a8'])
  })

  it('badge 非法 hex 回退默认、enabled 默认开', () => {
    const cfg = loadConfig({ badge: { bg: 'red', maxWidth: 1 } })
    expect(cfg.badge.bg).toBe(DEFAULTS.badge.bg)
    expect(cfg.badge.maxWidth).toBe(DEFAULTS.badge.maxWidth)
    expect(cfg.badge.enabled).toBe(true)
    expect(loadConfig({ badge: { enabled: false } }).badge.enabled).toBe(false)
  })

  it('quotaRefreshMs 下限保护（<1s 视为非法）', () => {
    expect(loadConfig({ quotaRefreshMs: 100 }).quotaRefreshMs).toBe(DEFAULTS.quotaRefreshMs)
    expect(loadConfig({ quotaRefreshMs: 5000 }).quotaRefreshMs).toBe(5000)
  })
})
