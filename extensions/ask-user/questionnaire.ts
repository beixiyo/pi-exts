/** 多题问卷：统一管理题间导航、保留草稿、答案确认与取消/中止生命周期 */
import type { Theme } from '@earendil-works/pi-coding-agent'
import type { Component, Focusable, KeybindingsManager, TUI } from '@earendil-works/pi-tui'
import { Key, matchesKey, Text } from '@earendil-works/pi-tui'
import { type Answer, AskUserSelectComponent, type OneQuestion } from './dialog'
import { formatKeys } from './keys'

/** 一个 custom UI 实例承载整组问题，Alt+左右切题不会销毁编辑器 */
export class AskUserQuestionnaire implements Component, Focusable {
  private readonly dialogs: AskUserSelectComponent[]
  private readonly answers = new Map<number, Answer>()
  private currentIndex = 0
  private _focused = false
  private closed = false

  constructor(private readonly config: QuestionnaireOptions) {
    this.dialogs = config.questions.map((question, index) =>
      new AskUserSelectComponent({
        tui: config.tui,
        theme: config.theme,
        kb: config.kb,
        question,
        placeholder: config.placeholder,
        onSubmit: (answer) => this.confirm(index, answer),
        onCancel: () => this.finish('cancelled'),
        onChange: () => this.answers.delete(index),
      })
    )
    config.signal?.addEventListener('abort', this.abort, { once: true })
    if (config.signal?.aborted) this.abort()
  }

  /** 仅当前题目持有光标焦点 */
  get focused(): boolean {
    return this._focused
  }

  set focused(value: boolean) {
    this._focused = value
    this.dialogs[this.currentIndex]!.focused = value && !this.closed
  }

  /** Alt+左右专用于切题；普通左右键始终交给输入框 */
  handleInput(data: string): void {
    if (this.closed) return
    const dialog = this.dialogs[this.currentIndex]!
    if (!dialog.isPasting && !data.includes('\x1b[200~') && matchesKey(data, Key.alt('left'))) {
      this.navigate(this.currentIndex - 1)
    }
    else if (!dialog.isPasting && !data.includes('\x1b[200~') && matchesKey(data, Key.alt('right'))) {
      this.navigate(this.currentIndex + 1)
    }
    else {
      dialog.handleInput(data)
    }
    this.config.tui.requestRender()
  }

  /** 显示当前位置及确认进度；最后一题 Enter 才尝试提交整组 */
  render(width: number): string[] {
    const count = this.dialogs.length
    const progress = `Question ${this.currentIndex + 1}/${count} · ${this.answers.size}/${count} confirmed`
    const { theme, kb } = this.config
    const hint = count > 1
      ? theme.fg('dim', ' · ') + theme.fg('accent', formatKeys(['alt+left', 'alt+right'])) + theme.fg('dim', ' switch · ')
        + theme.fg('accent', formatKeys([...kb.getKeys('tui.select.confirm'), ...kb.getKeys('tui.input.submit')]))
        + theme.fg('dim', ' confirm / submit on last question')
      : ''
    return [
      ...new Text(theme.fg('dim', progress) + hint, 1, 0).render(width),
      ...this.dialogs[this.currentIndex]!.render(width),
    ]
  }

  /** 全部草稿同步失效，以便回退时应用最新主题 */
  invalidate(): void {
    for (const dialog of this.dialogs) dialog.invalidate()
  }

  /** 清理中止监听器并使所有待完成粘贴失效；可重复调用 */
  dispose(): void {
    this.closed = true
    this.config.signal?.removeEventListener('abort', this.abort)
    for (const dialog of this.dialogs) dialog.focused = false
  }

  private readonly abort = (): void => this.finish('aborted')

  private navigate(index: number): void {
    if (index < 0 || index >= this.dialogs.length || index === this.currentIndex) return
    this.dialogs[this.currentIndex]!.focused = false
    this.currentIndex = index
    this.dialogs[index]!.focused = this.focused
  }

  private confirm(index: number, answer: Answer): void {
    this.answers.set(index, answer)
    if (index < this.dialogs.length - 1) {
      this.navigate(index + 1)
      return
    }
    // 允许 Alt+→ 跳过未答题，但不能将其误报为已回答
    const missing = this.dialogs.findIndex((_, i) => !this.answers.has(i))
    if (missing >= 0) this.navigate(missing)
    else this.finish('completed')
  }

  private finish(status: QuestionnaireResult['status']): void {
    if (this.closed) return
    const answers = [...this.answers.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, answer]) => ({ index, question: this.config.questions[index]!.question, answer }))
    this.dispose()
    this.config.done({ status, answers, currentIndex: this.currentIndex })
  }
}

/** 整组交互结果；只返回明确确认的答案，题号保留原始位置 */
export interface QuestionnaireResult {
  status: 'completed' | 'cancelled' | 'aborted'
  answers: { index: number; question: string; answer: Answer }[]
  currentIndex: number
}

/** 整组组件的运行时依赖 */
interface QuestionnaireOptions {
  tui: TUI
  theme: Theme
  kb: KeybindingsManager
  questions: OneQuestion[]
  placeholder?: string
  signal?: AbortSignal
  done: (result: QuestionnaireResult) => void
}
