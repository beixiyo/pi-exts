/** ask_user 工具契约：批量澄清问题、可回退修改的问卷，以及明确区分空选/取消的 Q/A 结果 */
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { readExtensionConfig } from '../../lib/settings'
import { AskUserQuestionnaire, type QuestionnaireResult } from './questionnaire'

const singleQuestion = {
  question: Type.String({ minLength: 1, description: 'One short, specific question; include enough context to make the decision' }),
  options: Type.Optional(Type.Array(Type.String({ minLength: 1 }), {
    description:
      'Suggested answers; custom text is always allowed. Omit for free input. Multi-select automatically adds an exclusive None of the above option; do not add it yourself',
  })),
  multiple: Type.Optional(Type.Boolean({
    description:
      'Allow multiple answers (default false). Tab toggles choices; Enter confirms checked choices plus custom text. Empty selection requires explicitly choosing None of the above',
  })),
  placeholder: Type.Optional(Type.String({
    description: 'Optional hint for the custom-answer editor',
  })),
}

const parameters = Type.Object({
  questions: Type.Array(Type.Object(singleQuestion), {
    minItems: 1,
    description: 'Batch related questions in one call. Users can revisit and edit answers before final submission',
  }),
})

/** 工具调用未带 placeholder 时的输入提示（settings.askUser.placeholder） */
function defaultPlaceholder(): string | undefined {
  const value = readExtensionConfig('askUser')?.placeholder
  return typeof value === 'string' && value ? value : undefined
}

/** 保留题号，显式区分主动空选、空文本与尚未回答 */
function formatAnswers(answers: QuestionnaireResult['answers']): string {
  return answers.map(({ index, question, answer }) => {
    const text = Array.isArray(answer) ? (answer.length ? answer.join(' | ') : '(none selected)') : answer || '(empty answer)'
    return `Q${index + 1}: ${question}\nA${index + 1}: ${text}`
  }).join('\n\n')
}

/** 供扩展注册的批量澄清工具 */
export const askUserTool: ToolDefinition<typeof parameters> = {
  name: 'ask_user',
  label: 'Ask user',
  description:
    'Ask the user to resolve uncertainties before proceeding. Use for unclear requirements, scope, preferences, trade-offs, or permission; do not guess user intent. Batch related questions in `questions`. Supports suggested options, multiple selections, and custom text. Users can revise answers before submitting; cancellation is not approval.',
  promptSnippet: 'Ask the user to clarify requirements or decisions before acting on assumptions.',
  promptGuidelines: [
    'Whenever a requirement, intended behavior, scope, preference, trade-off, or permission is unclear, use ask_user before implementing or taking the affected action. Do not silently choose for the user. Investigate facts available in code, docs, or tools yourself; ask about any remaining uncertainty rather than guess.',
    'Batch related, specific questions in one ask_user call. If dialogs are unavailable or canceled, ask unresolved questions in chat; never treat cancellation or an empty answer as consent.',
  ],
  executionMode: 'sequential',
  parameters,

  async execute(_toolCallId, params, signal, _onUpdate, ctx) {
    if (!ctx.hasUI || ctx.mode !== 'tui') {
      return {
        content: [{ type: 'text', text: 'ask_user requires interactive terminal UI. Ask the user in plain text instead.' }],
        isError: true,
        details: undefined,
      }
    }
    if (signal?.aborted) {
      return { content: [{ type: 'text', text: 'Dialog aborted' }], isError: true, details: undefined }
    }
    if (params.questions.length === 0) {
      return { content: [{ type: 'text', text: 'Provide at least one question.' }], isError: true, details: undefined }
    }

    const result = await ctx.ui.custom<QuestionnaireResult>((tui, theme, kb, done) =>
      new AskUserQuestionnaire({
        tui,
        theme,
        kb,
        done,
        questions: params.questions,
        placeholder: defaultPlaceholder(),
        signal,
      })
    )
    const collected = formatAnswers(result.answers)
    if (result.status !== 'completed') {
      const reason = result.status === 'aborted' ? 'Dialog aborted' : 'The user canceled'
      return {
        content: [{
          type: 'text',
          text: `${reason} at question ${result.currentIndex + 1} of ${params.questions.length}.${
            collected ? ` Confirmed answers:\n\n${collected}\n\n` : ' '
          }Unlisted questions are unanswered. Do not treat cancellation as approval or retry the dialogs; ask unresolved questions in plain text.`,
        }],
        isError: true,
        details: undefined,
      }
    }
    return {
      content: [{ type: 'text', text: `The user answered ${params.questions.length} question${params.questions.length > 1 ? 's' : ''}:\n\n${collected}` }],
      details: undefined,
    }
  },
}
