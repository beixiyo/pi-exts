/**
 * ask_user 工具定义：questions 数组依次弹窗，规整 Q/A 返回
 *
 * - questions 数组依次弹窗，一题答完出下一题（单问即单元素数组）；
 *   中途 esc 中止后续，已完成的答案仍带回，剩余题目建议模型改用纯文本补问
 * - 无 options → ui.input 文本输入框；有 options → 组合对话框（见 ./dialog.ts）
 * - multiple: true → 多选模式：tab 勾选/取消当前项，enter 提交全部勾选项
 * - 非交互模式（-p / rpc / json 无 UI）→ 返回错误提示，不挂起
 */
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { readExtensionConfig } from '../../lib/settings'
import { Type } from 'typebox'
import { AskUserSelectComponent } from './dialog'

const singleQuestion = {
  question: Type.String({ description: 'The question to ask the user; short and specific' }),
  options: Type.Optional(Type.Array(Type.String(), {
    description: 'Candidate options; the user can still type a custom answer in the input box at the bottom of the dialog',
  })),
  multiple: Type.Optional(Type.Boolean({
    description: 'Multi-select mode: tab toggles items, enter submits all checked items; suited for checklist-style questions',
  })),
  placeholder: Type.Optional(Type.String({
    description: 'Placeholder hint for the input box (free-input box when no options, custom-answer box when options are given)',
  })),
}

const parameters = Type.Object({
  questions: Type.Array(Type.Object(singleQuestion), {
    description: 'Questions to ask in sequence — one dialog per question; a single-element array asks one question. Prefer batching related questions into one call instead of repeated tool calls',
  }),
})

/** 单个待问问题（questions 数组项） */
interface OneQuestion {
  question: string
  options?: string[]
  multiple?: boolean
  placeholder?: string
}

/** 工具调用未带 placeholder 时的输入框占位符（settings.askUser.placeholder） */
function defaultPlaceholder(): string | undefined {
  const value = readExtensionConfig('askUser')?.placeholder
  return typeof value === 'string' && value ? value : undefined
}

/** 已答问题的规整 Q/A 文本（多选用 | 分隔） */
function formatAnswers(answers: { question: string; answer: string | string[] }[]): string {
  return answers
    .map(({ question, answer }, i) => `Q${i + 1}: ${question}\nA${i + 1}: ${Array.isArray(answer) ? answer.join(' | ') : answer}`)
    .join('\n\n')
}

export const askUserTool: ToolDefinition<typeof parameters> = {
  name: 'ask_user',
  label: 'Ask user',
  description:
    'Pop up dialogs to ask the user and wait for the answers. Use it only for information only the user knows (preferences, credential locations, ambiguous requirements, choosing between viable options). Pass a `questions` array — one dialog per question, answers come back as a tidy Q/A list, and a single-element array asks one question. When options are provided the user can either pick from the list or type a custom answer in the input box at the bottom; with multiple: true, tab toggles items and enter submits all checked items — suited for checklist questions. Never ask for information you can look up yourself with other tools.',
  promptSnippet: 'When you need information only the user knows, ask via the ask_user dialog tool — batch related questions into one call using the `questions` array.',
  parameters,

  async execute(_toolCallId, params, signal, _onUpdate, ctx) {
    if (!ctx.hasUI) {
      return {
        content: [{
          type: 'text',
          text: 'ask_user is unavailable in non-interactive mode (no dialog UI). Ask the user in plain text instead.',
        }],
        isError: true,
        details: undefined,
      }
    }

    const list: OneQuestion[] = params.questions

    /** 弹出单个问题对话框；取消返回 undefined */
    const askOne = async (q: OneQuestion): Promise<string | string[] | undefined> => {
      if (q.options && q.options.length > 0) {
        // ui.custom 不支持 abort signal（pi API 限制）：run 被中止时弹窗仍在，
        // 需用户手动 esc 关闭；await 返回后统一由 signal.aborted 分支收尾
        return await ctx.ui.custom<string | string[] | undefined>(
          (_tui, theme, kb, done) => new AskUserSelectComponent(theme, kb, q.question, q.options!, q.placeholder ?? defaultPlaceholder(), done, q.multiple === true),
        )
      }
      return await ctx.ui.input(q.question, q.placeholder ?? defaultPlaceholder())
    }

    const answers: { question: string; answer: string | string[] }[] = []
    for (const [index, q] of list.entries()) {
      const answer = await askOne(q)

      if (signal?.aborted) {
        return {
          content: [{ type: 'text', text: 'Dialog aborted' }],
          isError: true,
          details: undefined,
        }
      }

      // 用户取消：中止后续问题；已答部分仍带回，剩余建议纯文本补问
      if (answer === undefined) {
        const collected = answers.length > 0 ? ` Answers collected before canceling:\n\n${formatAnswers(answers)}` : ''
        return {
          content: [{
            type: 'text',
            text: `The user canceled at question ${index + 1} of ${list.length}.${collected} Do not retry the dialogs; ask the remaining questions in plain text.`,
          }],
          isError: true,
          details: undefined,
        }
      }

      answers.push({ question: q.question, answer })
    }

    return {
      content: [{ type: 'text', text: `The user answered ${list.length} question${list.length > 1 ? 's' : ''}:\n\n${formatAnswers(answers)}` }],
      details: undefined,
    }
  },
}
