/**
 * rename 模型解析：autoRename 配置读取与 provider/model/thinking 解析
 *
 * ## 配置（~/.pi/agent/settings.json 的 autoRename 键，整段可省略，省省时跟随主模型）
 *   {
 *     "autoRename": {
 *       "model": "zai/glm-5.3-flash", // "provider/model" 或 "provider/model:thinking"
 *       "thinkingLevel": "minimal",     // off | minimal | low | medium | high | xhigh | max
 *       "maxLen": 24                    // 标题最大字符数
 *     }
 *   }
 */
import { type ModelThinkingLevel } from '@earendil-works/pi-ai'
import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import { readSettings } from '../../lib/settings'

/** 合法思考强度：pi-ai 规范化枚举（各厂商差异由 provider 层的 thinkingLevelMap 翻译）
 * 用于解析 model 后缀与校验配置；实际传给模型前用 clampThinkingLevel 收敛到该模型支持的级别 */
const THINKING_LEVELS = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const)

/** 标题最大字符数（settings.autoRename.maxLen 的缺省值） */
export const DEFAULT_MAX_LEN = 24

export type AutoRenameSettings = {
  model?: string
  thinkingLevel?: string
  maxLen?: number
}

export type ModelRef = { provider: string; modelId: string; thinkingLevel: ModelThinkingLevel }

type PiSettings = { defaultProvider?: string; defaultModel?: string; autoRename?: AutoRenameSettings }

/** 读取 pi settings（lib/settings 负责合并 global 与 project） */
export function readPiSettings(): PiSettings {
  return readSettings() as PiSettings
}

/** 解析 "provider/model" / "provider/model:thinking" / "model"（无前缀时 provider 由 fallback 提供）*/
export function parseModelRef(spec: string, fallbackProvider?: string, fallbackThinking: ModelThinkingLevel = 'minimal'): ModelRef | null {
  const trimmed = spec.trim()
  if (!trimmed) return null
  let provider = ''
  let modelId = trimmed

  // 显式 "provider/model" 前缀无条件优先拆分：否则 fallbackProvider 存在时
  // 整串会被误当作 modelId（如 "zai/glm-5-turbo" → modelId 仍带前缀，find 失败）
  const slash = trimmed.indexOf('/')
  if (slash !== -1) {
    provider = trimmed.slice(0, slash).trim()
    modelId = trimmed.slice(slash + 1).trim()
  }
  if (!provider) provider = fallbackProvider ?? ''

  let thinkingLevel = fallbackThinking
  const colon = modelId.lastIndexOf(':')

  const suffix = modelId.slice(colon + 1).trim()
  if (colon !== -1 && (THINKING_LEVELS as Set<string>).has(suffix)) {
    thinkingLevel = suffix as ModelThinkingLevel
    modelId = modelId.slice(0, colon).trim()
  }
  if (!provider || !modelId) return null

  return { provider, modelId, thinkingLevel }
}

/** 模型解析：autoRename.model → pi defaultModel → 当前会话模型 */
export function resolveModelRef(ctx: ExtensionContext): ModelRef | null {
  const settings = readPiSettings()
  const thinking = settings.autoRename?.thinkingLevel?.trim()
  const fallbackThinking: ModelThinkingLevel = thinking && (THINKING_LEVELS as Set<string>).has(thinking) ? thinking as ModelThinkingLevel : 'minimal'

  const spec = settings.autoRename?.model
    ?? (settings.defaultModel ? `${settings.defaultProvider ?? ''}/${settings.defaultModel}` : '')
  const ref = spec ? parseModelRef(spec, settings.defaultProvider, fallbackThinking) : null
  if (ref) return ref

  const current = ctx.model
  if (!current) return null
  return { provider: String(current.provider), modelId: current.id, thinkingLevel: fallbackThinking }
}
