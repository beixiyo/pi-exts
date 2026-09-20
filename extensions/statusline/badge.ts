/**
 * 输入框徽标：装饰现有编辑器，仅在上边框右端嵌入会话名背景色块
 *
 * 转发全部接口，不替换底层实现（pi-vim 的 ModalEditor 等），
 * vim/补全/IME 光标均不受影响
 */
import type { AutocompleteProvider, EditorComponent, TuiMouseEvent, TuiMouseEventResult } from '@earendil-works/pi-tui'
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'
import { badgeLabel } from './colors'
import { CONFIG, type StatuslineConfig } from './config'

export class SessionBadgeEditor implements EditorComponent {
  constructor(
    private readonly inner: EditorComponent,
    private readonly getName: () => string | undefined,
    private readonly cfg: StatuslineConfig = CONFIG,
  ) {}

  render(width: number): string[] {
    const lines = this.inner.render(width)
    const name = this.getName()
    if (!name || lines.length === 0) return lines
    const label = badgeLabel(name, this.cfg, this.cfg.badge.maxWidth ?? width)
    const labelWidth = visibleWidth(label)
    if (labelWidth > width) return lines
    lines[0] = truncateToWidth(lines[0]!, width - labelWidth, '') + label
    return lines
  }

  invalidate(): void {
    this.inner.invalidate()
  }

  handleInput(data: string): void {
    this.inner.handleInput(data)
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    return this.inner.handleMouse?.(event)
  }

  get wantsKeyRelease(): boolean | undefined {
    return this.inner.wantsKeyRelease
  }

  getText(): string {
    return this.inner.getText()
  }

  setText(text: string): void {
    this.inner.setText(text)
  }

  addToHistory(text: string): void {
    this.inner.addToHistory?.(text)
  }

  insertTextAtCursor(text: string): void {
    this.inner.insertTextAtCursor?.(text)
  }

  getExpandedText(): string {
    return this.inner.getExpandedText?.() ?? this.getText()
  }

  setAutocompleteProvider(provider: AutocompleteProvider): void {
    this.inner.setAutocompleteProvider?.(provider)
  }

  setAutocompleteMaxVisible(maxVisible: number): void {
    this.inner.setAutocompleteMaxVisible?.(maxVisible)
  }

  setPaddingX(padding: number): void {
    this.inner.setPaddingX?.(padding)
  }

  // 宿主读写转发（提交/变更回调、边框色由宿主挂接到编辑器实例上）
  get onSubmit() {
    return this.inner.onSubmit
  }

  set onSubmit(fn: ((text: string) => void) | undefined) {
    this.inner.onSubmit = fn
  }

  get onChange() {
    return this.inner.onChange
  }

  set onChange(fn: ((text: string) => void) | undefined) {
    this.inner.onChange = fn
  }

  get borderColor() {
    return this.inner.borderColor
  }

  set borderColor(fn: ((str: string) => string) | undefined) {
    this.inner.borderColor = fn
  }

  // Focusable 转发（IME 候选窗光标定位）
  get focused(): boolean {
    return (this.inner as unknown as { focused?: boolean }).focused ?? false
  }

  set focused(value: boolean) {
    ;(this.inner as unknown as { focused: boolean }).focused = value
  }

  // ── app 级动作转发（必须）──
  // pi 安装自定义编辑器时按鸭子类型（"actionHandlers" in editor && instanceof Map）
  // 把 app.clear（C-c 清空/双击退出）、app.exit、escape 中断等处理器拷贝到最外层
  // 组件。包装类不暴露这些成员时拷贝被整体跳过，内层编辑器的处理器表为空，
  // 所有 app 级快捷键失效（症状：双击 C-c 无法退出）。转发到 inner 后，
  // pi 写入的处理器由 inner.handleInput 分发时原样读到，包装层零参与
  get actionHandlers(): Map<string, () => void> | undefined {
    return (this.inner as unknown as { actionHandlers?: Map<string, () => void> }).actionHandlers
  }

  get onEscape(): (() => void) | undefined {
    return (this.inner as unknown as { onEscape?: () => void }).onEscape
  }

  set onEscape(fn: (() => void) | undefined) {
    ;(this.inner as unknown as { onEscape?: () => void }).onEscape = fn
  }

  get onCtrlD(): (() => void) | undefined {
    return (this.inner as unknown as { onCtrlD?: () => void }).onCtrlD
  }

  set onCtrlD(fn: (() => void) | undefined) {
    ;(this.inner as unknown as { onCtrlD?: () => void }).onCtrlD = fn
  }

  get onPasteImage(): (() => void) | undefined {
    return (this.inner as unknown as { onPasteImage?: () => void }).onPasteImage
  }

  set onPasteImage(fn: (() => void) | undefined) {
    ;(this.inner as unknown as { onPasteImage?: () => void }).onPasteImage = fn
  }

  get onExtensionShortcut(): ((data: string) => boolean) | undefined {
    return (this.inner as unknown as { onExtensionShortcut?: (data: string) => boolean }).onExtensionShortcut
  }

  set onExtensionShortcut(fn: ((data: string) => boolean) | undefined) {
    ;(this.inner as unknown as { onExtensionShortcut?: (data: string) => boolean }).onExtensionShortcut = fn
  }
}
