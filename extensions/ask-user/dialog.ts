/** 单题对话框：选项、多行答案、显式「不选择」及输入校验；题间导航由 questionnaire 管理 */
import type { Theme } from '@earendil-works/pi-coding-agent'
import type { Component, Focusable, KeybindingsManager, KeyId, TUI } from '@earendil-works/pi-tui'
import { Container, Editor, Spacer, Text } from '@earendil-works/pi-tui'
import { readClipboardText, saveClipboardImageToTemp } from '../../lib/clipboard'
import { formatKeys } from './keys'

/** 保留单题编辑器和选择状态，切题时不重建草稿 */
export class AskUserSelectComponent implements Component, Focusable {
  private readonly container = new Container()
  private readonly listContainer = new Container()
  private readonly message = new Text('', 1, 0)
  private readonly input: Editor
  private readonly checked = new Set<number>()
  private readonly options: readonly string[]
  private readonly multiple: boolean
  private selectedIndex = 0
  private noneSelected = false
  private _focused = false
  private revision = 0
  private pasteInProgress = false

  constructor(private readonly config: AskUserSelectOptions) {
    const { theme, tui, question, placeholder } = config
    this.options = question.options ?? []
    this.multiple = question.multiple === true
    this.input = new Editor(tui, {
      borderColor: (text) => theme.fg('muted', text),
      selectList: {
        selectedPrefix: (text) => theme.fg('accent', text),
        selectedText: (text) => theme.fg('accent', text),
        description: (text) => theme.fg('muted', text),
        scrollInfo: (text) => theme.fg('dim', text),
        noMatch: (text) => theme.fg('warning', text),
      },
    }, { paddingX: 1 })
    // 提交由组件负责，避免 Editor 的默认提交清空草稿
    this.input.disableSubmit = true
    this.input.onChange = () => {
      if (this.input.getText().trim()) this.noneSelected = false
      this.changed()
    }

    this.container.addChild(new Spacer(1))
    this.container.addChild(new Text(theme.fg('accent', theme.bold(question.question)), 1, 0))
    this.container.addChild(new Spacer(1))
    this.container.addChild(this.listContainer)
    this.container.addChild(
      new Text(
        theme.fg(
          'muted',
          question.placeholder ?? placeholder ?? (
            this.multiple ? 'Custom answer (added to checked items)' : this.options.length ? 'Custom answer (empty = use selection)' : 'Your answer'
          ),
        ),
        1,
        0,
      ),
    )
    this.container.addChild(this.input)
    this.container.addChild(this.message)
    const { kb } = config
    const hint = (keys: readonly KeyId[], description: string) => theme.fg('accent', formatKeys(keys)) + theme.fg('dim', ` ${description}`)
    const hints = [
      ...(this.optionCount > 0 ? [hint([...kb.getKeys('tui.select.up'), ...kb.getKeys('tui.select.down')], 'select')] : []),
      ...(this.multiple ? [hint(kb.getKeys('tui.input.tab'), 'toggle')] : []),
      hint(['left', 'right'], 'cursor'),
      hint(kb.getKeys('tui.input.newLine'), 'newline'),
      hint(kb.getKeys('app.clipboard.pasteImage'), 'paste image'),
      hint([...kb.getKeys('tui.select.confirm'), ...kb.getKeys('tui.input.submit')], 'confirm'),
      hint(kb.getKeys('tui.select.cancel'), 'cancel'),
    ]
    this.container.addChild(new Text(hints.join(theme.fg('dim', ' · ')), 1, 0))
    this.container.addChild(new Spacer(1))
    this.updateList()
  }

  /** Focusable：转发焦点供 IME 定位；焦点变化使待完成粘贴失效 */
  get focused(): boolean {
    return this._focused
  }

  set focused(value: boolean) {
    if (this._focused !== value) this.revision++
    this._focused = value
    this.input.focused = value
  }

  /** 处理单题按键；纯输入题的上下键保留给多行编辑器 */
  handleInput(data: string): void {
    const { kb, onCancel } = this.config
    // 分块括号粘贴期间不把粘贴内容中的控制字符当成提交或导航
    if (this.pasteInProgress || data.includes('\x1b[200~')) {
      this.pasteInProgress = !data.includes('\x1b[201~')
      this.input.handleInput(data)
      return
    }
    if (kb.matches(data, 'app.clipboard.pasteImage')) {
      void this.pasteFromClipboard()
      return
    }
    if (kb.matches(data, 'tui.select.cancel')) {
      onCancel()
      return
    }
    if (kb.matches(data, 'tui.input.newLine')) {
      this.input.handleInput(data)
      return
    }
    if (kb.matches(data, 'tui.select.confirm') || kb.matches(data, 'tui.input.submit')) {
      this.submit()
      return
    }
    if (this.multiple && kb.matches(data, 'tui.input.tab')) {
      if (this.selectedIndex === this.options.length) {
        this.noneSelected = !this.noneSelected
        if (this.noneSelected) {
          this.checked.clear()
          this.input.setText('')
        }
      }
      else {
        this.noneSelected = false
        if (this.checked.has(this.selectedIndex)) this.checked.delete(this.selectedIndex)
        else this.checked.add(this.selectedIndex)
      }
      this.changed()
      return
    }
    if (this.optionCount > 0 && (kb.matches(data, 'tui.select.up') || kb.matches(data, 'tui.select.down'))) {
      const direction = kb.matches(data, 'tui.select.up') ? -1 : 1
      const next = Math.max(0, Math.min(this.optionCount - 1, this.selectedIndex + direction))
      if (next !== this.selectedIndex) {
        this.selectedIndex = next
        if (!this.multiple && !this.input.getText().trim()) this.changed()
        else this.updateList()
      }
      return
    }
    this.input.handleInput(data)
  }

  /** 是否正在接收括号粘贴，供上层避免拦截粘贴中的导航序列 */
  get isPasting(): boolean {
    return this.pasteInProgress
  }

  /** 渲染时由 Editor 根据终端列宽自动折行并保持光标可见 */
  render(width: number): string[] {
    return this.container.render(width)
  }

  /** 使主题及子组件缓存失效 */
  invalidate(): void {
    this.container.invalidate()
  }

  private get optionCount(): number {
    return this.options.length + (this.multiple ? 1 : 0)
  }

  /** 未操作的多选题不能提交；空数组只能来自主动勾选「不选择」 */
  private submit(): void {
    const value = this.input.getExpandedText()
    const custom = value.trim()
    if (this.multiple) {
      const selections = [...this.checked].sort((a, b) => a - b).map((index) => this.options[index]!)
      const answer = custom ? [...selections, custom] : selections
      if (answer.length > 0 || this.noneSelected) this.config.onSubmit(answer)
      else {
        this.message.setText(this.config.theme.fg('warning', 'Use Tab to select an answer or None of the above, or type a custom answer.'))
        this.config.tui.requestRender()
      }
      return
    }
    // 保持纯输入题允许空字符串的既有契约
    this.config.onSubmit(this.options.length === 0 ? value : custom || this.options[this.selectedIndex]!)
  }

  /** 任何答案变化都使上层的已确认答案失效，避免回退修改后提交旧值 */
  private changed(): void {
    this.revision++
    this.message.setText('')
    this.config.onChange()
    this.updateList()
  }

  /** 异步粘贴只写回仍在当前焦点、且未发生新编辑的原始草稿 */
  private async pasteFromClipboard(): Promise<void> {
    const revision = this.revision
    const text = (await saveClipboardImageToTemp()) ?? await readClipboardText()
    if (!text || !this.focused || revision !== this.revision) return
    this.input.insertTextAtCursor(text)
    this.config.tui.requestRender()
  }

  private updateList(): void {
    this.listContainer.clear()
    const options = this.multiple ? [...this.options, 'None of the above'] : this.options
    for (const [index, option] of options.entries()) {
      const checked = index === this.options.length ? this.noneSelected : this.checked.has(index)
      const checkbox = this.multiple ? (checked ? '[x] ' : '[ ] ') : ''
      const text = index === this.selectedIndex
        ? this.config.theme.fg('accent', `→ ${checkbox}${option}`)
        : this.config.theme.fg('text', `  ${checkbox}${option}`)
      this.listContainer.addChild(new Text(text, 1, 0))
    }
  }
}

/** 单题定义，与 ask_user 的 questions 数组项一致 */
export interface OneQuestion {
  question: string
  options?: string[]
  /** 是否多选；启用后自动添加互斥的「不选择」 @default false */
  multiple?: boolean
  /** 自定义输入提示；缺省使用工具配置或模式对应的内置文案 */
  placeholder?: string
}

/** 单题答案；空数组表示用户主动选择「不选择」，不是取消 */
export type Answer = string | string[]

/** 单题组件依赖与事件，生命周期和题间导航由调用方管理 */
interface AskUserSelectOptions {
  tui: TUI
  theme: Theme
  kb: KeybindingsManager
  question: OneQuestion
  placeholder?: string
  onSubmit: (answer: Answer) => void
  onCancel: () => void
  onChange: () => void
}
