/** 真实组件及工具接线回归：折行、显式空选、回退修改、取消/中止与异步粘贴 */
import type { ExtensionContext, Theme } from '@earendil-works/pi-coding-agent'
import type { TUI } from '@earendil-works/pi-tui'
import { CURSOR_MARKER, KeybindingsManager, setKeybindings, TUI_KEYBINDINGS, visibleWidth } from '@earendil-works/pi-tui'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readClipboardText, saveClipboardImageToTemp } from '../../lib/clipboard'
import { AskUserSelectComponent, type OneQuestion } from './dialog'
import { AskUserQuestionnaire, type QuestionnaireResult } from './questionnaire'
import { askUserTool } from './tool'

vi.mock('../../lib/clipboard', () => ({ readClipboardText: vi.fn(), saveClipboardImageToTemp: vi.fn() }))

// 只替换终端宿主与着色；编辑器、按键解析、问卷及工具 execute 都使用生产代码
const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text } as Theme
const kb = new KeybindingsManager({
  ...TUI_KEYBINDINGS,
  'app.clipboard.pasteImage': { defaultKeys: 'ctrl+v', description: 'Paste clipboard' },
})
const left = '\x1b[D'
const down = '\x1b[B'
const prev = '\x1b[1;3D'
const next = '\x1b[1;3C'

function host(): TUI {
  return { terminal: { rows: 40 }, requestRender: vi.fn() } as unknown as TUI
}

function single(question: OneQuestion) {
  const done = vi.fn()
  const cancel = vi.fn()
  const dialog = new AskUserSelectComponent({
    tui: host(),
    theme,
    kb,
    question,
    onSubmit: done,
    onCancel: cancel,
    onChange: vi.fn(),
  })
  dialog.focused = true
  return { dialog, done, cancel }
}

function questionnaire(questions: OneQuestion[], signal?: AbortSignal) {
  const done = vi.fn<(result: QuestionnaireResult) => void>()
  const dialog = new AskUserQuestionnaire({ tui: host(), theme, kb, questions, done, signal })
  dialog.focused = true
  return { dialog, done }
}

beforeEach(() => {
  vi.resetAllMocks()
  setKeybindings(kb)
})

describe('single question', () => {
  it('does not treat an unchecked multi-select Enter as cancellation', () => {
    const { dialog, done, cancel } = single({ question: 'Pick', options: ['One', 'Two'], multiple: true })
    dialog.handleInput('\r')
    expect(done).not.toHaveBeenCalled()
    expect(cancel).not.toHaveBeenCalled()
    dialog.handleInput('\t')
    dialog.handleInput('\r')
    expect(done).toHaveBeenCalledWith(['One'])
  })

  it('wraps long CJK/emoji text across widths without losing content or IME focus', () => {
    const { dialog, done } = single({ question: 'Pick' })
    const text = 'START 中文🙂 abcdefghijklmnopqrstuvwxyz END'
    dialog.handleInput(text)
    for (const width of [20, 30, 80]) {
      const lines = dialog.render(width)
      expect(lines.join('\n')).toContain('START')
      expect(lines.join('\n')).toContain('END')
      expect(lines.join('\n')).toContain(CURSOR_MARKER)
      expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true)
    }
    dialog.handleInput('\r')
    expect(done).toHaveBeenCalledWith(text)
  })

  it('preserves multiline editing, arrow cursor movement, and raw free input', () => {
    const { dialog, done } = single({ question: 'Explain' })
    dialog.handleInput('abc')
    dialog.handleInput('\n') // Ctrl+J
    dialog.handleInput('de')
    dialog.handleInput(left)
    dialog.handleInput('X')
    expect(done).not.toHaveBeenCalled()
    dialog.handleInput('\r')
    expect(done).toHaveBeenCalledWith('abc\ndXe')
    const empty = single({ question: 'Optional note' })
    empty.dialog.handleInput('\r')
    expect(empty.done).toHaveBeenCalledWith('')
  })

  it.each(['none', 'option', 'custom'])('keeps None exclusive when followed by %s', (action) => {
    const { dialog, done } = single({ question: 'Pick', options: ['One', 'Two'], multiple: true })
    dialog.handleInput('\t') // One
    dialog.handleInput(down)
    dialog.handleInput(down)
    dialog.handleInput('\t') // None clears One
    if (action === 'option') {
      dialog.handleInput('\x1b[A')
      dialog.handleInput('\t') // Two clears None
    }
    if (action === 'custom') dialog.handleInput('Other') // custom clears None
    dialog.handleInput('\r')
    expect(done).toHaveBeenCalledWith(action === 'none' ? [] : action === 'option' ? ['Two'] : ['Other'])
  })

  it('expands large bracketed pastes on submission instead of returning a paste marker', () => {
    const { dialog, done } = single({ question: 'Explain' })
    const text = 'long pasted answer\n'.repeat(30).trim()
    dialog.handleInput(`\x1b[200~${text}\x1b[201~`)
    dialog.handleInput('\r')
    expect(done).toHaveBeenCalledWith(text)
  })
})

describe('question navigation and lifecycle', () => {
  it('keeps drafts when navigating and reconfirms edits instead of returning stale answers', () => {
    const { dialog, done } = questionnaire([{ question: 'First' }, { question: 'Second' }])
    dialog.handleInput('first')
    dialog.handleInput('\r')
    dialog.handleInput('second')
    dialog.handleInput(prev)
    dialog.handleInput(left)
    dialog.handleInput('X')
    dialog.handleInput(next)
    dialog.handleInput('\r') // First was edited, so return there for confirmation
    expect(done).not.toHaveBeenCalled()
    expect(dialog.render(80).join('\n')).toContain('Question 1/2')
    dialog.handleInput('\r')
    dialog.handleInput('\r')
    expect(done.mock.calls[0]![0]).toMatchObject({
      status: 'completed',
      answers: [{ index: 0, answer: 'firsXt' }, { index: 1, answer: 'second' }],
    })
  })

  it('preserves checkbox state and custom drafts across Alt navigation', () => {
    const { dialog, done } = questionnaire([
      { question: 'Pick', options: ['One', 'Two'], multiple: true },
      { question: 'End' },
    ])
    dialog.handleInput('\t')
    dialog.handleInput('Other')
    dialog.handleInput(next)
    dialog.handleInput(prev)
    dialog.handleInput(down)
    dialog.handleInput('\t')
    dialog.handleInput('\r')
    dialog.handleInput('\r')
    expect(done.mock.calls[0]![0].answers[0]!.answer).toEqual(['One', 'Two', 'Other'])
  })

  it('does not submit unanswered questions skipped with Alt+Right', () => {
    const { dialog, done } = questionnaire([{ question: 'First' }, { question: 'Last' }])
    dialog.handleInput(prev) // bounded at the first question
    dialog.handleInput(next)
    dialog.handleInput(next) // bounded at the last question
    dialog.handleInput('last')
    dialog.handleInput('\r')
    expect(done).not.toHaveBeenCalled()
    dialog.handleInput('first')
    dialog.handleInput('\r')
    dialog.handleInput('\r')
    expect(done.mock.calls[0]![0].answers.map((item) => item.answer)).toEqual(['first', 'last'])
  })

  it('cancels with only still-confirmed answers and their original question indexes', () => {
    const { dialog, done } = questionnaire([{ question: 'First' }, { question: 'Second' }, { question: 'Third' }])
    dialog.handleInput(next)
    dialog.handleInput('second')
    dialog.handleInput('\r')
    dialog.handleInput('\x1b')
    expect(done.mock.calls[0]![0]).toEqual({
      status: 'cancelled',
      currentIndex: 2,
      answers: [{ index: 1, question: 'Second', answer: 'second' }],
    })
  })

  it('finishes once on abort and ignores subsequent input', () => {
    const controller = new AbortController()
    const { dialog, done } = questionnaire([{ question: 'First' }], controller.signal)
    controller.abort()
    dialog.handleInput('\r')
    dialog.dispose()
    expect(done).toHaveBeenCalledExactlyOnceWith({ status: 'aborted', answers: [], currentIndex: 0 })
  })

  it('does not apply a late clipboard response after leaving and returning to a question', async () => {
    let resolve!: (value: string) => void
    vi.mocked(saveClipboardImageToTemp).mockReturnValue(
      new Promise<string>((r) => {
        resolve = r
      }),
    )
    const { dialog, done } = questionnaire([{ question: 'First' }, { question: 'Second' }])
    dialog.handleInput('\x16')
    dialog.handleInput(next)
    dialog.handleInput(prev)
    resolve('/tmp/image.png')
    await Promise.resolve()
    dialog.handleInput('first')
    dialog.handleInput('\r')
    dialog.handleInput('second')
    dialog.handleInput('\r')
    expect(done.mock.calls[0]![0].answers.map((item) => item.answer)).toEqual(['first', 'second'])
  })

  it('still supports clipboard text fallback and image paths in the active editor', async () => {
    vi.mocked(saveClipboardImageToTemp).mockResolvedValue(null)
    vi.mocked(readClipboardText).mockResolvedValue('clipboard\ntext')
    const { dialog, done } = single({ question: 'Explain' })
    dialog.handleInput('\x16')
    await vi.waitFor(() => expect(dialog.render(80).join('\n')).toContain('clipboard'))
    vi.mocked(saveClipboardImageToTemp).mockResolvedValue('/tmp/image.png')
    dialog.handleInput('\x16')
    await vi.waitFor(() => expect(dialog.render(80).join('\n')).toContain('/tmp/image.png'))
    dialog.handleInput('\r')
    expect(done).toHaveBeenCalledWith('clipboard\ntext/tmp/image.png')
  })
})

describe('tool integration', () => {
  it('returns an explicit None answer through the real custom UI callback', async () => {
    const custom = vi.fn((_factory: unknown) => {})
    const ctx = { hasUI: true, mode: 'tui', ui: { custom } } as unknown as ExtensionContext
    // 使用真实 ui.custom 工厂，只模拟宿主负责的挂载、输入和完成回调
    ctx.ui.custom = async (factory) =>
      new Promise((resolve) => {
        const component = factory(host(), theme, kb as Parameters<typeof factory>[2], resolve) as AskUserQuestionnaire
        component.focused = true
        component.handleInput(down)
        component.handleInput('\t')
        component.handleInput('\r')
      })
    const result = await askUserTool.execute(
      'test',
      {
        questions: [{ question: 'Pick', options: ['One'], multiple: true }],
      },
      undefined,
      undefined,
      ctx,
    )
    expect(result.content).toEqual([{ type: 'text', text: 'The user answered 1 question:\n\nQ1: Pick\nA1: (none selected)' }])
  })

  it('refuses RPC even when hasUI is true', async () => {
    const custom = vi.fn()
    const ctx = { hasUI: true, mode: 'rpc', ui: { custom } } as unknown as ExtensionContext
    const result = await askUserTool.execute('test', { questions: [{ question: 'Pick' }] }, undefined, undefined, ctx)
    expect(result).toMatchObject({ isError: true })
    expect(custom).not.toHaveBeenCalled()
  })
})
