/**
 * Statusline 配置：类型、默认值与归一化（非法项丢弃/降级并回退默认，绝不抛错）
 *
 * ## 配置（~/.pi/agent/settings.json 的 statusline 键，整段可省略）
 * - left / right：段落声明数组，按序渲染；删一项即隐藏该段，换序即调整显示顺序；
 *   某段无数据（如不在 git 仓库、未命名会话）时自动跳过；right 的 quota 段会
 *   动态展开为各厂商有数据的配额段；窄终端时 right 从数组尾部开始逐段丢弃
 * - color 三种写法：
 *   1. 主题语义色（ThemeColor 名，如 'text'/'muted'/'success'，跟随 pi 主题）
 *   2. 真彩 hex（如 '#4aa5f0'，直接输出 24-bit 色；256 色终端自动降级最近色）
 *   3. 'auto'——按用量百分比自动变色，仅用量段（context/quota）允许，阈值见 autoLevels
 * - autoLevels：'auto' 变色档位（normal 为色板：未达 warn 阈值时各用量段按序轮换取色，
 *   保证段间区分；warn/danger 为统一警报色）
 * - separator：段落间分隔符与分隔符颜色
 * - hiddenStatusKeys：隐藏的扩展状态键（footer 不显示，功能本身不受影响）
 * - quotaRefreshMs：配额刷新节流（毫秒）
 * - badge：输入框徽标（会话名以背景色块嵌入输入框上边框右端）
 */
import { createDebug } from '../../lib/debug'
import { readExtensionConfig } from '../../lib/settings'

export const debug = createDebug('STATUSLINE_DEBUG', '/tmp/statusline-debug.log')

/** 左侧段落标识（决定取数逻辑） */
export type LeftSegmentType = 'model' | 'thinking' | 'branch' | 'sessionName' | 'extensionStatus'

/** 右侧段落标识：context 用量 + quota 各厂商配额段（动态展开） */
export type RightSegmentType = 'context' | 'quota'

/** context 段显示风格：
 * - 'pct'       仅百分比（如 `ctx 42% used`）
 * - 'pct-used'  百分比 + 已用 tokens（如 `ctx 42% 84K`，默认；绝对值补齐百分比缺失的余量信息）
 * - 'pct-total' 百分比 / 总窗口（如 `ctx 42%/200K`；总窗口是常量，适合常切模型看窗口差异）
 * - 'used-total' 已用/总量（如 `ctx 84K/200K`；纯绝对值，百分比由 auto 变色承载） */
export type ContextStyle = 'pct' | 'pct-used' | 'pct-total' | 'used-total'

/** statusline 固定文案（默认英文；非英文用户可整体或按需覆盖） */
export interface StatuslineLabels {
  /** context 段前缀，如 `ctx` */
  ctx: string
  /** 百分比后缀（pct 风格与 quota 段的 `% used`），如 `used` */
  used: string
  /** thinking 段前缀 */
  thinking: string
  /** 模型不可用时的占位 */
  noModel: string
}

/** hex 色声明，如 '#4aa5f0'（#RRGGBB） */
export type HexColor = `#${string}`

/** 段落颜色：主题语义色 / 真彩 hex / 'auto'（仅用量段允许） */
export type SegmentColor = string | HexColor | 'auto'

/** 归一化后的段落声明（非法配置项在加载时丢弃并记调试日志） */
export interface LeftSegment {
  type: LeftSegmentType
  color: SegmentColor
}
export interface RightSegment {
  type: RightSegmentType
  color: SegmentColor
}

export interface StatuslineConfig {
  left: readonly LeftSegment[]
  right: readonly RightSegment[]
  contextStyle: ContextStyle
  labels: StatuslineLabels
  autoLevels: { warnAt: number; dangerAt: number; normal: readonly string[]; warn: string; danger: string }
  separator: { left: string; right: string; color: string }
  hiddenStatusKeys: readonly string[]
  quotaRefreshMs: number
  badge: { enabled: boolean; bg: HexColor; fg: HexColor | undefined; maxWidth: number | null }
}

/** 默认值（settings 无 statusline 键时整体生效；也是各字段的回退值） */
export const DEFAULTS = {
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
  contextStyle: 'pct-used',
  labels: {
    ctx: 'ctx',
    used: 'used',
    thinking: 'thinking',
    noModel: 'no-model',
  } satisfies StatuslineLabels,
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
const CONTEXT_STYLES = new Set<ContextStyle>(['pct', 'pct-used', 'pct-total', 'used-total'])
export const HEX_RE = /^#[0-9a-f]{6}$/i

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

/**
 * 配置归一化
 * @param raw 已读取的原始配置对象；缺省从 settings.json 读取（测试可注入）
 */
export function loadConfig(raw: Record<string, unknown> | undefined = readExtensionConfig('statusline')): StatuslineConfig {
  const parseList = (raw: unknown, types: ReadonlySet<string>, allowAuto: boolean, where: string) =>
    Array.isArray(raw)
      ? raw
        .map((entry) => parseSegment(entry, types, allowAuto, where))
        .filter((entry): entry is { type: string; color: SegmentColor } => entry !== undefined)
      : []

  const left = parseList(raw?.left, LEFT_TYPES, false, 'left') as LeftSegment[]
  const right = parseList(raw?.right, RIGHT_TYPES, true, 'right') as RightSegment[]

  const levels = raw?.autoLevels && typeof raw.autoLevels === 'object' && !Array.isArray(raw.autoLevels)
    ? raw.autoLevels as Record<string, unknown>
    : {}
  const THEME_COLOR_NAMES = new Set(['text', 'muted', 'dim', 'success', 'warning', 'error', 'accent'])
  const isColorValue = (value: unknown): value is string => typeof value === 'string' && (HEX_RE.test(value) || THEME_COLOR_NAMES.has(value))
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

  const sep = raw?.separator && typeof raw.separator === 'object' && !Array.isArray(raw.separator)
    ? raw.separator as Record<string, unknown>
    : {}
  const sepColor = typeof sep.color === 'string' && (HEX_RE.test(sep.color) || sep.color.trim()) ? sep.color.trim() : DEFAULTS.separator.color

  const badge = raw?.badge && typeof raw.badge === 'object' && !Array.isArray(raw.badge)
    ? raw.badge as Record<string, unknown>
    : {}
  const badgeBg = typeof badge.bg === 'string' && HEX_RE.test(badge.bg) ? badge.bg as HexColor : DEFAULTS.badge.bg
  const badgeFg = typeof badge.fg === 'string' && HEX_RE.test(badge.fg) ? badge.fg as HexColor : DEFAULTS.badge.fg
  const badgeWidth = typeof badge.maxWidth === 'number' && Number.isInteger(badge.maxWidth) && badge.maxWidth >= 4 ? badge.maxWidth : DEFAULTS.badge.maxWidth

  const refresh = typeof raw?.quotaRefreshMs === 'number' && Number.isFinite(raw.quotaRefreshMs) && raw.quotaRefreshMs >= 1000
    ? raw.quotaRefreshMs
    : DEFAULTS.quotaRefreshMs

  const styleRaw = raw?.contextStyle
  const contextStyle = typeof styleRaw === 'string' && (CONTEXT_STYLES as Set<string>).has(styleRaw)
    ? styleRaw as ContextStyle
    : DEFAULTS.contextStyle
  if (typeof styleRaw === 'string' && styleRaw !== contextStyle) {
    debug(`invalid contextStyle ${JSON.stringify(styleRaw)} → ${DEFAULTS.contextStyle}`)
  }

  /** 文案覆盖：逐项接受非空字符串，其余回退默认英文 */
  const labelsRaw = raw?.labels && typeof raw.labels === 'object' && !Array.isArray(raw.labels)
    ? raw.labels as Record<string, unknown>
    : {}
  const labelOf = (key: keyof StatuslineLabels): string => {
    const value = labelsRaw[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (value !== undefined) debug(`labels.${key} invalid → default`)
    return DEFAULTS.labels[key]
  }
  const labels: StatuslineLabels = {
    ctx: labelOf('ctx'),
    used: labelOf('used'),
    thinking: labelOf('thinking'),
    noModel: labelOf('noModel'),
  }

  return {
    left: left.length > 0 ? left : DEFAULTS.left,
    right: right.length > 0 ? right : DEFAULTS.right,
    contextStyle,
    labels,
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
    hiddenStatusKeys: Array.isArray(raw?.hiddenStatusKeys)
      ? raw.hiddenStatusKeys.filter((k): k is string => typeof k === 'string')
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

/** 扩展加载时读取一次（改 settings 后 /reload 或下会话生效） */
export const CONFIG = loadConfig()
