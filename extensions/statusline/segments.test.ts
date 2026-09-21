/**
 * quota 段按当前模型 provider 过滤的行为契约测试
 *
 * 捕获的失败面：footer 只显示当前 provider 的配额段（README 公共契约）；
 * 过滤写错、model 未就绪/切换间隙显示旧厂商段任一回归都会暴露
 */
import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import { describe, expect, it, vi } from 'vitest'

vi.mock('./config', () => ({
  CONFIG: {
    hiddenStatusKeys: [],
    contextStyle: 'pct-used',
    labels: { ctx: 'ctx', used: 'used', thinking: 'thinking', noModel: 'no-model' },
  },
  debug: () => {},
}))

import type { QuotaSegment } from '../../lib/quota'
import { contextText, createRightTexts, formatTokens, localizeQuotaText } from './segments'

const QUOTA: QuotaSegment[] = [
  { provider: 'zai', text: '5h 12% used', pct: 12 },
  { provider: 'zai', text: 'wk 30% used', pct: 30 },
  { provider: 'openai-codex', text: 'wk 1% used', pct: 1 },
]

function makeCtx(provider: string | undefined): ExtensionContext {
  return {
    model: provider === undefined ? undefined : { provider, id: 'x', name: 'X' },
    getContextUsage: () => null,
  } as unknown as ExtensionContext
}

const texts = (ctx: ExtensionContext) => createRightTexts(ctx, () => QUOTA)('quota')

const USAGE = { tokens: 84_500, contextWindow: 200_000, percent: 42.25 }
const EN = { ctx: 'ctx', used: 'used', thinking: 'thinking', noModel: 'no-model' }

describe('contextText 风格与文案', () => {
  it('四种 contextStyle 的默认英文输出', () => {
    expect(contextText('pct', USAGE, EN)).toBe('ctx 42% used')
    expect(contextText('pct-used', USAGE, EN)).toBe('ctx 42% 85K')
    expect(contextText('pct-total', USAGE, EN)).toBe('ctx 42%/200K')
    expect(contextText('used-total', USAGE, EN)).toBe('ctx 85K/200K')
  })

  it('labels 本地化文案生效', () => {
    expect(contextText('pct', USAGE, { ...EN, ctx: '上下文', used: '已用' })).toBe('上下文 42% 已用')
    expect(contextText('pct-used', USAGE, { ...EN, ctx: '上下文' })).toBe('上下文 42% 85K')
  })

  it('tokens/percent 未知时退占位', () => {
    expect(contextText('pct-used', { tokens: null, contextWindow: 200_000, percent: null }, EN)).toBe('ctx ?')
  })
})

describe('formatTokens', () => {
  it('K/M 阶梯换算与舍入', () => {
    expect(formatTokens(950)).toBe('950')
    expect(formatTokens(84_500)).toBe('85K')
    expect(formatTokens(200_000)).toBe('200K')
    expect(formatTokens(1_000_000)).toBe('1M')
    expect(formatTokens(1_540_000)).toBe('1.5M')
    expect(formatTokens(25_000_000)).toBe('25M')
  })
})

describe('localizeQuotaText', () => {
  it('替换尾部 % used 后缀；非百分比形态与默认文案原样返回', () => {
    expect(localizeQuotaText('5h 12% used', '已用')).toBe('5h 12% 已用')
    expect(localizeQuotaText('OR $4.20', '已用')).toBe('OR $4.20')
    expect(localizeQuotaText('wk reset 4d22h', '已用')).toBe('wk reset 4d22h')
    expect(localizeQuotaText('5h 12% used', 'used')).toBe('5h 12% used')
  })
})

describe('quota 段 provider 过滤', () => {
  it('只保留当前 provider 的段', () => {
    const parts = texts(makeCtx('zai'))
    expect(parts.map((p) => p.text)).toEqual(['5h 12% used', 'wk 30% used'])
  })

  it('无配额 adapter 的 provider（如 google）不显示任何段', () => {
    expect(texts(makeCtx('google'))).toEqual([])
  })

  it('model 未就绪不显示任何段（不用全量兜底）', () => {
    expect(texts(makeCtx(undefined))).toEqual([])
  })

  it('切换间隙的旧厂商段被过滤（缓存尚未刷新时不闪旧数据）', () => {
    // 切到 openai-codex 后缓存里还全是 zai 段：全部滤掉，等新数据落地
    const stale = QUOTA.filter((seg) => seg.provider === 'zai')
    const parts = createRightTexts(makeCtx('openai-codex'), () => stale)('quota')
    expect(parts).toEqual([])
  })
})
