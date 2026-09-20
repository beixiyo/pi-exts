/**
 * rename 标题生成：小模型调用、标题清洗、会话文本提取
 *
 * 调试：RENAME_DEBUG=1 启动 pi，命名过程写入 /tmp/rename-debug.log
 */
import { clampThinkingLevel } from '@earendil-works/pi-ai'
import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import { createDebug } from '../../lib/debug'
import { extractText } from '../../lib/message'
import { resolveModelRef } from './model'

/** 调试日志：环境变量开关与写入路径 */
const DEBUG_ENV = 'RENAME_DEBUG'
const DEBUG_LOG = '/tmp/rename-debug.log'

/** 标题生成的模型调用超时（防悬空 promise 无限挂着）*/
const TITLE_TIMEOUT_MS = 20_000

/** 自动命名：取首轮用户消息的最大长度 */
const MAX_FIRST_INPUT = 800

/** /rename 重新生成：单条消息截断、总预算、保留的最近轮数（不含首条）*/
const MAX_TURN_TEXT = 500
const MAX_CONVERSATION = 2_000
const RECENT_TURNS = 4

/** 标题生成指令（给模型的 system prompt；指示模型跟随会话语言输出）*/
const SYSTEM_PROMPT = 'You generate a short title for a coding session. Output only the title itself: no quotes, no trailing punctuation, no explanation or affixes. '
  + 'Use the same language as the conversation; at most 16 characters for Chinese, at most 10 words for English. '
  + 'Make it specific enough that the user can recognize the session at a glance in a session list.'

export const debug = createDebug(DEBUG_ENV, DEBUG_LOG)

/** 标题清洗：剥引号/代码块/换行/句尾标点，硬截断保词边界 */
export function cleanTitle(raw: string, maxLen: number): string {
  let title = raw.trim()
    .replace(/^```(?:\w+)?\s*/i, '').replace(/```\s*$/i, '')
    .replace(/^['"「『]+|['"」』]+$/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[。.!！?？~～]+$/g, '')
    .trim()

  if (title.length > maxLen) {
    const cut = title.slice(0, maxLen)
    const lastSpace = cut.lastIndexOf(' ')
    title = (lastSpace > maxLen * 0.6 ? cut.slice(0, lastSpace) : cut).trim()
  }
  return title
}

/** 调用小模型生成标题；失败返回空串（best-effort，绝不打扰主流程）
 * 20s 超时中止，防悬空 promise 无限挂着 */
export async function generateTitle(ctx: ExtensionContext, content: string, maxLen: number): Promise<string> {
  const ref = resolveModelRef(ctx)
  debug('ref=', JSON.stringify(ref), 'content.len=', content.length)
  if (!ref || !content.trim()) return ''

  try {
    const model = ctx.modelRegistry.find(ref.provider, ref.modelId)
    const provider = model ? ctx.modelRegistry.getProvider(model.provider) : undefined
    debug('model=', !!model, 'provider=', !!provider)
    if (!model || !provider) return ''

    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model)
    debug('auth.ok=', auth.ok, 'hasKey=', !!(auth as { apiKey?: string }).apiKey)
    if (!auth.ok || !auth.apiKey) return ''
    const { apiKey, headers, env } = auth

    const clampedLevel = clampThinkingLevel(model, ref.thinkingLevel)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TITLE_TIMEOUT_MS)
    try {
      const response = await provider.streamSimple(
        model,
        {
          systemPrompt: SYSTEM_PROMPT,
          messages: [{
            role: 'user',
            content: [{ type: 'text', text: `会话内容：\n${content}` }],
            timestamp: Date.now(),
          }],
        },
        {
          apiKey,
          headers,
          env,
          reasoning: clampedLevel === 'off' ? undefined : clampedLevel,
          signal: controller.signal,
        },
      ).result()

      if (response.stopReason === 'error' || response.stopReason === 'aborted') {
        debug('stopReason=', response.stopReason, 'err=', (response as { errorMessage?: string }).errorMessage)
        return ''
      }

      const text = response.content
        .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
        .map((part) => part.text)
        .join(' ')
      debug('modelText=', JSON.stringify(text))

      return cleanTitle(text, maxLen)
    }
    finally {
      clearTimeout(timer)
    }
  }
  catch (err) {
    debug('threw=', String(err))
    return ''
  }
}

/** 从会话分支提取对话文本：首轮用户消息（自动命名用） */
export function firstUserText(ctx: ExtensionContext): string {
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== 'message') continue

    const message = (entry as { message?: { role?: string; content?: unknown } }).message
    if (message?.role !== 'user') continue

    const text = extractText(message.content).trim()
    if (text) return text.slice(0, MAX_FIRST_INPUT)
  }
  return ''
}

/** 最近几轮对话文本（/rename 无参数重新生成用） */
export function recentConversationText(ctx: ExtensionContext): string {
  const turns: string[] = []

  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== 'message') continue
    const message = (entry as { message?: { role?: string; content?: unknown } }).message
    const role = message?.role === 'user' ? 'User' : message?.role === 'assistant' ? 'Assistant' : null

    if (!role || !message) continue
    const text = extractText(message.content).trim()
    if (text) turns.push(`[${role}]: ${text.slice(0, MAX_TURN_TEXT)}`)
  }

  // 首条保底 + 最近若干条，总预算限制
  if (turns.length === 0) return ''
  const opening = turns[0]
  const tail = turns.length > 1 ? turns.slice(1).slice(-RECENT_TURNS) : []
  return [opening, ...tail].join('\n\n').slice(0, MAX_CONVERSATION)
}
