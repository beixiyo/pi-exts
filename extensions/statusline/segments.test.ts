/**
 * quota 段按当前模型 provider 过滤的行为契约测试
 *
 * 捕获的失败面：footer 只显示当前 provider 的配额段（README 公共契约）；
 * 过滤写错、model 未就绪/切换间隙显示旧厂商段任一回归都会暴露
 */
import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import { describe, expect, it, vi } from 'vitest'

vi.mock('./config', () => ({
  CONFIG: { hiddenStatusKeys: [] },
  debug: () => {},
}))

import type { QuotaSegment } from '../../lib/quota'
import { createRightTexts } from './segments'

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
