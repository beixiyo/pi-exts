/**
 * Statusline — 声明式配置的彩色 footer（色板参照 tokyonight-pretty_cat.vim）
 *
 * ════════════════════ 配置方式（settings.json 的 statusline 键）════════════════════
 *
 * 所有可调项集中在 settings.json，整段可省略（省略即用下方 DEFAULTS 默认值）：
 * - left / right：段落声明数组，按序渲染；删一项即隐藏该段，换序即调整显示顺序；
 *   某段无数据（如不在 git 仓库、未命名会话）时自动跳过；right 的 quota 段会
 *   动态展开为各厂商有数据的配额段；窄终端时 right 从数组尾部开始逐段丢弃
 * - color 三种写法：
 *   1. 主题语义色（ThemeColor 名，如 'text'/'muted'/'success'，跟随 pi 主题）
 *   2. 真彩 hex（如 '#4aa5f0'，直接输出 24-bit 色；终端仅支持 256 色时自动降级最近色）
 *   3. 'auto'——按用量百分比自动变色，仅用量段（context/quota）允许，阈值见 autoLevels
 * - autoLevels：'auto' 变色档位（normal 为色板：未达 warn 阈值时各用量段按序轮换取色，
 *   保证段间区分；warn/danger 为统一警报色）
 * - separator：段落间分隔符与分隔符颜色
 * - hiddenStatusKeys：隐藏的扩展状态键（footer 不显示，功能本身不受影响）
 * - quotaRefreshMs：配额刷新节流（毫秒）
 * - badge：输入框徽标（会话名以背景色块嵌入输入框上边框右端）
 *
 * 配额数据由 lib/quota 各厂商 adapter 提供（GLM Coding Plan / OpenRouter /
 * DeepSeek / OpenAI），凭证只读 auth.json 与环境变量
 *
 * 输入框徽标通过 getEditorComponent() 装饰现有编辑器（如 pi-vim 的
 * ModalEditor）而非替换，vim 功能不受影响
 *
 * 仅 TUI 模式启用；启动时和每轮结束后刷新配额（节流静默）
 * 调试：STATUSLINE_DEBUG=1 启动 pi，非法配置项写入 /tmp/statusline-debug.log
 */
import type { ExtensionAPI, Theme } from '@earendil-works/pi-coding-agent'
import { CustomEditor } from '@earendil-works/pi-coding-agent'
import type { AutocompleteProvider, EditorComponent, TuiMouseEvent, TuiMouseEventResult } from '@earendil-works/pi-tui'
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'
import { createDebug } from '../lib/debug'
import { fetchQuotas } from '../lib/quota'
import type { QuotaSegment } from '../lib/quota'
import { readExtensionConfig } from '../lib/settings'

const debug = createDebug('STATUSLINE_DEBUG', '/tmp/statusline-debug.log')

// ════════════════════ 配置 ════════════════════

/** 左侧段落标识（决定取数逻辑） */
type LeftSegmentType = 'model' | 'thinking' | 'branch' | 'sessionName' | 'extensionStatus'

/** 右侧段落标识：context 用量 + quota 各厂商配额段（动态展开） */
type RightSegmentType = 'context' | 'quota'

/** hex 色声明，如 '#4aa5f0'（#RRGGBB） */
type HexColor = `#${string}`

/** 段落颜色：主题语义色 / 真彩 hex / 'auto'（仅用量段允许） */
type SegmentColor = string | HexColor | 'auto'

/** 归一化后的段落声明（非法配置项在加载时丢弃并记调试日志） */
interface LeftSegment { type: LeftSegmentType; color: SegmentColor }
interface RightSegment { type: RightSegmentType; color: SegmentColor }

interface StatuslineConfig {
  left: readonly LeftSegment[]
  right: readonly RightSegment[]
  autoLevels: { warnAt: number; dangerAt: number; normal: readonly string[]; warn: string; danger: string }
  separator: { left: string; right: string; color: string }
  hiddenStatusKeys: readonly string[]
  quotaRefreshMs: number
  badge: { enabled: boolean; bg: HexColor; fg: HexColor | undefined; maxWidth: number | null }
}

/** 默认值（settings 无 statusline 键时整体生效；也是各字段的回退值） */
const DEFAULTS = {
  left: [
    { type: 'model', color: '#4aa5f0' },
    { type: 'thinking', color: '#c678dd' },
    { type: 'branch', color: '#98c379' },
    { type: 'extensionStatus', color: '#e5c07b' },
  ] as { type: LeftSegmentType; color: SegmentColor }[],
  right: [
    { type: 'context', color: 'auto' },
    { type: 'quota', color: 'auto' },
  ] as { type: RightSegmentType; color: SegmentColor }[],
  autoLevels: {
    warnAt: 70,
    dangerAt: 90,
    /** normal 档色板：右侧展开后的用量段按序轮换取色（蓝→teal→青→绿），保证段间区分 */
    normal: ['#4aa5f0', '#6dc7a8', '#42b3c2', '#98c379'] as readonly string[],
    warn: '#e5c07b',
    danger: '#c24038',
  },
  separator: { left: ' · ', right: '  ', color: '#7f848e' },
  hiddenStatusKeys: ['mcp'],
  quotaRefreshMs: 60_000,
  badge: {
    enabled: true,
    bg: '#4aa5f0',
    fg: undefined as HexColor | undefined,
    maxWidth: null as number | null,
  },
} satisfies StatuslineConfig

const LEFT_TYPES = new Set<LeftSegmentType>(['model', 'thinking', 'branch', 'sessionName', 'extensionStatus'])
const RIGHT_TYPES = new Set<RightSegmentType>(['context', 'quota'])
const HEX_RE = /^#[0-9a-f]{6}$/i

/** 单个段落声明校验：type 在白名单内；'auto' 仅用量段；其余任意非空字符串视为颜色 */
function parseSegment(
  raw: unknown,
  types: ReadonlySet<string>,
  allowAuto: boolean,
  where: string,
): { type: string; color: SegmentColor } | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const { type, color } = raw as { type?: unknown; color?: unknown }
  if (typeof type !== 'string' || !types.has(type)) {
    debug(`drop ${where} segment: unknown type ${JSON.stringify(type)}`)
    return undefined
  }
  if (color === undefined) return { type, color: 'text' }
  if (color === 'auto') {
    if (!allowAuto) {
      debug(`downgrade ${where}.${type} 'auto' → 'text' (not a usage segment)`)
      return { type, color: 'text' }
    }
    return { type, color: 'auto' }
  }
  if (typeof color !== 'string' || !color.trim()) {
    debug(`drop ${where} segment ${type}: invalid color`)
    return undefined
  }
  return { type, color: color.trim() }
}

/** 配置归一化：非法项丢弃/降级并回退默认，绝不抛错 */
function loadConfig(): StatuslineConfig {
  const cfg = readExtensionConfig('statusline')

  const parseList = (raw: unknown, types: ReadonlySet<string>, allowAuto: boolean, where: string) =>
    Array.isArray(raw)
      ? raw
        .map((entry) => parseSegment(entry, types, allowAuto, where))
        .filter((entry): entry is { type: string; color: SegmentColor } => entry !== undefined)
      : []

  const left = parseList(cfg?.left, LEFT_TYPES, false, 'left') as LeftSegment[]
  const right = parseList(cfg?.right, RIGHT_TYPES, true, 'right') as RightSegment[]

  const levels = cfg?.autoLevels && typeof cfg.autoLevels === 'object' && !Array.isArray(cfg.autoLevels)
    ? cfg.autoLevels as Record<string, unknown>
    : {}
  const THEME_COLOR_NAMES = new Set(['text', 'muted', 'dim', 'success', 'warning', 'error', 'accent'])
  const isColorValue = (value: unknown): value is string =>
    typeof value === 'string' && (HEX_RE.test(value) || THEME_COLOR_NAMES.has(value))
  /** 单个警报色（warn/danger）：非法值回退默认 */
  const colorOf = (key: string, fallback: string): string => {
    const value = levels[key]
    return isColorValue(value) ? value : fallback
  }
  /** normal 档色板：接受单色或色板数组，逐项过滤非法色，空则回退默认色板 */
  const paletteOf = (raw: unknown, fallback: readonly string[]): readonly string[] => {
    const candidates = Array.isArray(raw) ? raw : [raw]
    const picked = candidates.filter(isColorValue)
    return picked.length > 0 ? picked : fallback
  }
  const thresholdOf = (key: string, fallback: number): number => {
    const value = levels[key]
    return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 100 ? value : fallback
  }

  const sep = cfg?.separator && typeof cfg.separator === 'object' && !Array.isArray(cfg.separator)
    ? cfg.separator as Record<string, unknown>
    : {}
  const sepColor = typeof sep.color === 'string' && (HEX_RE.test(sep.color) || sep.color.trim()) ? sep.color.trim() : DEFAULTS.separator.color

  const badge = cfg?.badge && typeof cfg.badge === 'object' && !Array.isArray(cfg.badge)
    ? cfg.badge as Record<string, unknown>
    : {}
  const badgeBg = typeof badge.bg === 'string' && HEX_RE.test(badge.bg) ? badge.bg as HexColor : DEFAULTS.badge.bg
  const badgeFg = typeof badge.fg === 'string' && HEX_RE.test(badge.fg) ? badge.fg as HexColor : DEFAULTS.badge.fg
  const badgeWidth = typeof badge.maxWidth === 'number' && Number.isInteger(badge.maxWidth) && badge.maxWidth >= 4 ? badge.maxWidth : DEFAULTS.badge.maxWidth

  const refresh = typeof cfg?.quotaRefreshMs === 'number' && Number.isFinite(cfg.quotaRefreshMs) && cfg.quotaRefreshMs >= 1000
    ? cfg.quotaRefreshMs
    : DEFAULTS.quotaRefreshMs

  return {
    left: left.length > 0 ? left : DEFAULTS.left,
    right: right.length > 0 ? right : DEFAULTS.right,
    autoLevels: {
      warnAt: thresholdOf('warnAt', DEFAULTS.autoLevels.warnAt),
      dangerAt: thresholdOf('dangerAt', DEFAULTS.autoLevels.dangerAt),
      normal: paletteOf(levels.normal, DEFAULTS.autoLevels.normal),
      warn: colorOf('warn', DEFAULTS.autoLevels.warn),
      danger: colorOf('danger', DEFAULTS.autoLevels.danger),
    },
    separator: {
      left: typeof sep.left === 'string' && sep.left ? sep.left : DEFAULTS.separator.left,
      right: typeof sep.right === 'string' && sep.right ? sep.right : DEFAULTS.separator.right,
      color: sepColor,
    },
    hiddenStatusKeys: Array.isArray(cfg?.hiddenStatusKeys)
      ? cfg.hiddenStatusKeys.filter((k): k is string => typeof k === 'string')
      : DEFAULTS.hiddenStatusKeys,
    quotaRefreshMs: refresh,
    badge: {
      enabled: badge.enabled !== false,
      bg: badgeBg,
      fg: badgeFg,
      maxWidth: badgeWidth,
    },
  }
}

// ════════════════════ 颜色工具 ════════════════════

/** 'auto' 颜色解析：按用量百分比落档（warn/danger 统一警报色），
 * normal 档按段序在色板中轮换取色，保证同档位下段间可区分 */
function autoResolve(cfg: StatuslineConfig, color: SegmentColor, pct: number | null | undefined, index: number): string {
  if (color !== 'auto') return color
  if (pct !== null && pct !== undefined) {
    if (pct >= cfg.autoLevels.dangerAt) return cfg.autoLevels.danger
    if (pct >= cfg.autoLevels.warnAt) return cfg.autoLevels.warn
  }
  const palette = cfg.autoLevels.normal
  return palette[index % palette.length]!
}

/** hex 色判定（类型谓词） */
function isHexColor(color: string): color is HexColor {
  return HEX_RE.test(color)
}

function parseHex(hex: string): [number, number, number] | undefined {
  const match = HEX_RE.exec(hex)
  if (!match) return undefined
  const v = hex.slice(1)
  return [Number.parseInt(v.slice(0, 2), 16), Number.parseInt(v.slice(2, 4), 16), Number.parseInt(v.slice(4, 6), 16)]
}

/** xterm 216 色立方最近色索引 */
function cube256([r, g, b]: [number, number, number]): number {
  return 16 + 36 * Math.round((r / 255) * 5) + 6 * Math.round((g / 255) * 5) + Math.round((b / 255) * 5)
}

/** 统一着色：hex 走真彩（256 色终端降级最近色），其余走主题语义色 */
function colorize(theme: Theme, color: string, text: string): string {
  if (isHexColor(color)) {
    const rgb = parseHex(color)
    if (!rgb) return theme.fg('text', text) // 非法 hex 容错：回退主题主色
    return theme.getColorMode() === 'truecolor'
      ? `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m${text}\x1b[39m`
      : `\x1b[38;5;${cube256(rgb)}m${text}\x1b[39m`
  }
  try {
    return theme.fg(color as Parameters<Theme['fg']>[0], text)
  }
  catch {
    return theme.fg('text', text) // 未知主题色名容错
  }
}

/** 按背景亮度自动取对比前景色（亮底 → 主题深色，暗底 → 亮灰） */
function autoBadgeFg(bg: HexColor): HexColor {
  const rgb = parseHex(bg)
  const lum = rgb ? (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255 : 0
  return lum > 0.45 ? '#1e1e2e' : '#c2c2c2'
}

/** 会话名背景色块标签：' 名称 '（前后各留一格底色）
 * 编辑器 factory 只提供 EditorTheme（无颜色模式），改按 COLORTERM 检测；
 * 检测不到时保守输出 256 色索引（truecolor 终端也兼容） */
const TRUECOLOR = /truecolor|24bit/i.test(process.env.COLORTERM ?? '')

/** 徽标最长显示宽度（列），含前后底色空格，名称部分占 maxWidth - 2 */
function badgeLabel(name: string, cfg: StatuslineConfig, maxWidth: number): string {
  const text = ` ${truncateToWidth(name, Math.max(1, maxWidth - 2), '…')} `
  const bg = parseHex(cfg.badge.bg)
  const fg = parseHex(cfg.badge.fg ?? autoBadgeFg(cfg.badge.bg))
  if (!bg || !fg) return text
  if (TRUECOLOR) {
    return `\x1b[48;2;${bg[0]};${bg[1]};${bg[2]}m\x1b[38;2;${fg[0]};${fg[1]};${fg[2]}m${text}\x1b[39m\x1b[49m`
  }
  return `\x1b[48;5;${cube256(bg)}m\x1b[38;5;${cube256(fg)}m${text}\x1b[39m\x1b[49m`
}

// ════════════════════ 输入框徽标 ════════════════════

/** 装饰现有编辑器：转发全部接口，仅在上边框右端嵌入会话名背景色块
 * 不替换底层实现（pi-vim 的 ModalEditor 等），vim/补全/IME 光标均不受影响 */
class SessionBadgeEditor implements EditorComponent {
  constructor(
    private readonly inner: EditorComponent,
    private readonly getName: () => string | undefined,
  ) {}

  render(width: number): string[] {
    const lines = this.inner.render(width)
    const name = this.getName()
    if (!name || lines.length === 0) return lines
    const label = badgeLabel(name, CONFIG, CONFIG.badge.maxWidth ?? width)
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

/** 扩展加载时读取一次（改 settings 后 /reload 或下会话生效） */
const CONFIG = loadConfig()

export default function(pi: ExtensionAPI) {
  let quota: QuotaSegment[] = []
  let requestRender: (() => void) | undefined
  let lastFetch = 0
  let fetching = false

  async function refreshQuota(): Promise<void> {
    if (fetching || Date.now() - lastFetch < CONFIG.quotaRefreshMs) return
    fetching = true
    lastFetch = Date.now()
    try {
      quota = await fetchQuotas()
    }
    catch {
      // 静默：保留上次结果，下一轮再试
    }
    finally {
      fetching = false
      requestRender?.()
    }
  }

  pi.on('session_start', async (_event, ctx) => {
    if (ctx.mode !== 'tui') return
    void refreshQuota()

    // 输入框徽标：延迟一拍包装。局部扩展先于 package（pi-vim 等）初始化，
    // 立即读 getEditorComponent() 会拿到 undefined 且随后被 package 覆盖；
    // setTimeout(0) 等全部同步 session_start 跑完后再装饰现有编辑器
    if (CONFIG.badge.enabled) {
      setTimeout(() => {
        const existing = ctx.ui.getEditorComponent()
        const base = existing ?? ((tui, theme, kb) => new CustomEditor(tui, theme, kb))
        ctx.ui.setEditorComponent((tui, theme, kb) => new SessionBadgeEditor(base(tui, theme, kb), () => ctx.sessionManager.getSessionName()))
      }, 0)
    }

    ctx.ui.setFooter((tui, theme, footerData) => {
      requestRender = () => tui.requestRender()
      // 分支切换主动重绘；dispose 由 TUI 在替换/关闭 footer 时调用
      const dispose = footerData.onBranchChange(() => tui.requestRender())

      /** 左侧段取文本（extensionStatus 可产出多段），无数据返回空数组 */
      const leftTexts = (type: LeftSegmentType): string[] => {
        switch (type) {
          case 'model':
            return [ctx.model?.name ?? ctx.model?.id ?? 'no-model']
          case 'thinking':
            return [`thinking ${ctx.thinkingLevel ?? 'off'}`]
          case 'branch': {
            const branch = footerData.getGitBranch()
            return branch ? [branch] : []
          }
          case 'sessionName': {
            const name = ctx.sessionManager.getSessionName()
            return name ? [name] : []
          }
          case 'extensionStatus':
            return [...footerData.getExtensionStatuses()]
              .filter(([key]) => !CONFIG.hiddenStatusKeys.includes(key))
              .map(([, status]) => status)
        }
      }

      /** 右侧段取文本与用量百分比（可一扩多），无数据返回空数组 */
      const rightText = (type: RightSegmentType): { text: string; pct: number | null }[] => {
        switch (type) {
          case 'context': {
            const usage = ctx.getContextUsage()
            if (!usage) return []
            const pct = usage.percent
            return [{ text: pct === null ? 'ctx ?' : `ctx ${Math.round(pct)}% used`, pct }]
          }
          case 'quota':
            return quota.map((seg) => ({ text: seg.text, pct: seg.pct }))
        }
      }

      const render = (width: number): string[] => {
        // ── 左侧：遍历声明，无数据段跳过（左侧不允许 'auto'，index 固定 0 即可）──
        const leftParts = CONFIG.left.flatMap((seg) => leftTexts(seg.type).map((text) => colorize(theme, autoResolve(CONFIG, seg.color, null, 0), text)))
        const dot = colorize(theme, CONFIG.separator.color, CONFIG.separator.left)
        const left = ' ' + leftParts.join(dot)

        // ── 右侧：遍历声明（一声明可扩多段）；窄终端从尾部逐段丢弃 ──
        // color 随段带出：auto 在 normal 档按展开后的段序轮换色板
        const parts = CONFIG.right.flatMap((seg) => rightText(seg.type).map((part) => ({ ...part, color: seg.color })))
        const segments = parts.map((part, index) => colorize(theme, autoResolve(CONFIG, part.color, part.pct, index), part.text))

        const gap = colorize(theme, CONFIG.separator.color, CONFIG.separator.right)
        const kept = [...segments]
        while (kept.length > 0) {
          const right = kept.join(gap)
          const pad = width - visibleWidth(left) - visibleWidth(right) - 1
          if (pad >= 1) return [left + ' '.repeat(pad) + right]
          kept.pop()
        }
        return [truncateToWidth(left, width, '')]
      }

      return { render, invalidate() {}, dispose }
    })
  })

  // 每轮结束后配额已变化，刷新一次（内部节流）
  pi.on('turn_end', () => {
    void refreshQuota()
  })
}
