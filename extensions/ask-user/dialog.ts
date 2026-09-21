/**
 * ask_user 组合对话框：选项列表 + 底部自定义答案输入框
 *
 * 单焦点交互：可打印按键、退格、粘贴等全部进输入框；↑↓（跟随
 * tui.select.up/down 绑定）只走列表。enter 语义：输入框非空 → 提交
 * 自定义答案；空 → 提交当前选中项（多选模式提交全部勾选项）；无选项的
 * 纯输入模式提交原始输入。这样用户无需在两个焦点区之间切换
 * ctrl+v（app.clipboard.pasteImage）与主输入框对齐：剪贴板图片落盘插路径，
 * 无图片退回文本粘贴
 */
import { keyText, type Theme } from '@earendil-works/pi-coding-agent'
import type { Component, Focusable, KeybindingsManager } from '@earendil-works/pi-tui'
import { Container, Input, Spacer, Text } from '@earendil-works/pi-tui'
import { readClipboardText, saveClipboardImageToTemp } from '../../lib/clipboard'

export class AskUserSelectComponent implements Component, Focusable {
  private readonly container = new Container()
  private readonly listContainer = new Container()
  private readonly input: Input
  private readonly options: readonly string[]
  private readonly checked = new Set<number>()
  private selectedIndex = 0
  private _focused = false
  private readonly requestRender: () => void

  constructor(
    private readonly theme: Theme,
    private readonly kb: KeybindingsManager,
    question: string,
    options: readonly string[],
    placeholder: string | undefined,
    private readonly done: (result: string | string[] | undefined) => void,
    private readonly multiple = false,
    requestRender: () => void = () => {},
  ) {
    this.options = options
    this.requestRender = requestRender

    this.container.addChild(new Spacer(1))
    this.container.addChild(new Text(theme.fg('accent', theme.bold(question)), 1, 0))
    this.container.addChild(new Spacer(1))
    this.container.addChild(this.listContainer)
    this.container.addChild(new Spacer(1))
    this.input = new Input({
      prompt: '❯ ',
      placeholder: placeholder ?? 'Custom answer (empty = use selection)',
      placeholderStyle: (text) => theme.fg('muted', text),
    })
    this.container.addChild(this.input)
    this.container.addChild(new Spacer(1))
    const pasteHint = `${keyText('app.clipboard.pasteImage')} paste image`
    const selectHint = options.length > 0 ? '↑↓ select · ' : ''
    this.container.addChild(
      new Text(
        theme.fg(
          'dim',
          multiple
            ? `${selectHint}tab toggle · type for custom answer · ${pasteHint} · enter confirm · esc cancel`
            : `${selectHint}type for custom answer · ${pasteHint} · enter confirm · esc cancel`,
        ),
        1,
        0,
      ),
    )
    this.container.addChild(new Spacer(1))
    this.updateList()
  }

  /** Focusable：转发给输入框，IME 候选窗光标定位用 */
  get focused(): boolean {
    return this._focused
  }

  set focused(value: boolean) {
    this._focused = value
    this.input.focused = value
  }

  handleInput(data: string): void {
    // 剪贴板粘贴（默认 ctrl+v）对齐主输入框：优先图片落盘插路径，无图片退回文本
    if (this.kb.matches(data, 'app.clipboard.pasteImage')) {
      void this.pasteFromClipboard()
      return
    }
    if (this.kb.matches(data, 'tui.select.cancel')) {
      this.done(undefined)
      return
    }
    if (this.kb.matches(data, 'tui.select.confirm') || this.kb.matches(data, 'tui.input.submit')) {
      const value = this.input.getValue()
      const custom = value.trim()
      if (this.multiple) {
        const selections = [...this.checked].sort((a, b) => a - b).map((i) => this.options[i]!).filter(Boolean)
        const answer = custom !== '' ? [...selections, custom] : selections
        this.done(answer.length > 0 ? answer : undefined)
        return
      }
      // 纯输入模式：提交原始输入（空串也提交，与 pi 内置 ui.input 行为一致）
      if (this.options.length === 0) {
        this.done(value)
        return
      }
      if (custom !== '') {
        this.done(custom)
        return
      }
      const selected = this.options[this.selectedIndex]
      if (selected !== undefined) this.done(selected)
      return
    }
    // 多选模式 tab 为勾选键，不进输入框（空格仍归输入框，自定义答案可含空格）
    if (this.multiple && data === '\t') {
      if (this.checked.has(this.selectedIndex)) this.checked.delete(this.selectedIndex)
      else this.checked.add(this.selectedIndex)
      this.updateList()
      return
    }
    if (this.kb.matches(data, 'tui.select.up')) {
      if (this.selectedIndex > 0) {
        this.selectedIndex--
        this.updateList()
      }
      return
    }
    if (this.kb.matches(data, 'tui.select.down')) {
      if (this.selectedIndex < this.options.length - 1) {
        this.selectedIndex++
        this.updateList()
      }
      return
    }
    // 可打印字符、退格、左右移动、粘贴、撤销等全部交给输入框
    this.input.handleInput(data)
  }

  /** 剪贴板粘贴：图片落盘插入路径，无图片退回文本；完成后重绘 */
  private async pasteFromClipboard(): Promise<void> {
    const text = (await saveClipboardImageToTemp()) ?? await readClipboardText()
    if (!text) return
    // 经括号粘贴序列走 Input 的公开输入通路（其 handlePaste 为私有）
    this.input.handleInput(`\x1b[200~${text}\x1b[201~`)
    this.requestRender()
  }

  render(width: number): string[] {
    return this.container.render(width)
  }

  invalidate(): void {
    this.container.invalidate()
  }

  private updateList(): void {
    this.listContainer.clear()
    for (const [index, option] of this.options.entries()) {
      const checkbox = this.multiple ? (this.checked.has(index) ? '[x] ' : '[ ] ') : ''
      const text = index === this.selectedIndex
        ? this.theme.fg('accent', `→ ${checkbox}${option}`)
        : this.theme.fg('text', `  ${checkbox}${option}`)
      this.listContainer.addChild(new Text(text, 1, 0))
    }
  }
}
