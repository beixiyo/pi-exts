/**
 * parseModelRef 契约测试
 *
 * 捕获的失败面（生产注释中记载的历史缺陷）：
 * fallbackProvider 存在时 "zai/glm-5-turbo" 若不显式拆前缀，
 * 整串会被当作 modelId，后续 modelRegistry.find 永远失败 → 自动命名静默失效
 */
import { describe, expect, it } from 'vitest'
import { parseModelRef } from './model'

describe('parseModelRef', () => {
  it('显式 "provider/model" 优先拆分（历史坑回归）', () => {
    const ref = parseModelRef('zai/glm-5-turbo', 'openrouter')
    expect(ref).toEqual({ provider: 'zai', modelId: 'glm-5-turbo', thinkingLevel: 'minimal' })
  })

  it('无前缀时用 fallbackProvider', () => {
    const ref = parseModelRef('claude-sonnet-4', 'anthropic')
    expect(ref).toMatchObject({ provider: 'anthropic', modelId: 'claude-sonnet-4' })
  })

  it(':thinking 后缀解析并从 modelId 剥离', () => {
    const ref = parseModelRef('zai/glm-5.3:high')
    expect(ref).toMatchObject({ provider: 'zai', modelId: 'glm-5.3', thinkingLevel: 'high' })
  })

  it('非思考级别的冒号后缀保留在 modelId 中', () => {
    const ref = parseModelRef('openrouter/qwen-3-coder:free')
    expect(ref).toMatchObject({ modelId: 'qwen-3-coder:free' })
  })

  it('空串与缺 provider 返回 null', () => {
    expect(parseModelRef('   ')).toBeNull()
    expect(parseModelRef('only-model', undefined)).toBeNull()
  })
})
