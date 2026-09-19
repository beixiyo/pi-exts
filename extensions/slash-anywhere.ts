/**
 * Slash Anywhere — 句中命令与 skill 补全（/ Tab 手动 + 触发符自动）
 *
 * pi 内置补全只在「当前行行首打 /」时给命令建议；pi-tui 的
 * setAutocompleteTriggerCharacters 显式过滤 '/'，扩展无法让句中 / 自动触发，
 * 因此提供两条触发通道（Codex 用 $、Claude Code 用句中 / 的折中）：
 * - 句中空白后打 <触发符>xxx → 自动弹层（默认 $，可配置；$ 不在过滤名单）
 * - 句中空白后打 /xxx 再按 Tab → 手动弹层（force 路径不受过滤影响）
 * - 建议来自 getCommands()（命令/prompt/skill），选中后统一替换为 "/命令 " 形态
 * - 行首 / 场景原样委托内置 provider，行为不变（含参数补全）
 *
 * 注：pi 只执行「整条消息以 / 开头」的命令；句中补全产物是文本引用（与 Claude Code 一致）
 *
 * ## 配置（settings.json 的 slashAnywhere 键，可省略）
 *   {
 *     "slashAnywhere": {
 *       "autoTriggerChars": ["$"],   // 句中自动弹层的触发符；/ 始终走 Tab 手动触发
 *       "autoSources": ["skill"]     // $ 自动触发通道补全什么：extension | prompt | skill 任意组合
 *     }
 *   }
 */
import type { ExtensionAPI, SlashCommandInfo } from '@earendil-works/pi-coding-agent'
import type { AutocompleteItem, AutocompleteProvider } from '@earendil-works/pi-tui'
import { createDebug } from '../lib/debug'
import { readExtensionConfig } from '../lib/settings'

const debug = createDebug('SLASH_DEBUG', '/tmp/slash-debug.log')

/** 内置已占用的触发符（文件 @ / 引号 "），自定义时跳过 */
const RESERVED_CHARS = new Set(['@', '#', '"'])

/** 命令来源：扩展注册命令 / prompt 模板 / skill */
type CommandSource = SlashCommandInfo['source']
const COMMAND_SOURCES: readonly CommandSource[] = ['extension', 'prompt', 'skill']

/** 配置归一化：单个非字母数字符号、去重、避开内置 */
function loadAutoTriggerChars(): string[] {
  const raw = readExtensionConfig('slashAnywhere')?.autoTriggerChars
  if (!Array.isArray(raw)) return ['$']
  const chars = raw.filter((c): c is string =>
    typeof c === 'string' && c.length === 1 && /[^\w\s]/.test(c) && !RESERVED_CHARS.has(c))
  return [...new Set(chars)]
}

/** $ 自动触发通道的补全源（settings.slashAnywhere.autoSources，缺省仅 skill）
 * / + Tab 手动通道始终补全全部，不受此配置影响 */
function loadAutoSources(): ReadonlySet<CommandSource> {
  const raw = readExtensionConfig('slashAnywhere')?.autoSources
  if (!Array.isArray(raw)) return new Set<CommandSource>(['skill'])
  const picked = raw.filter((s): s is CommandSource =>
    typeof s === 'string' && (COMMAND_SOURCES as readonly string[]).includes(s))
  return new Set<CommandSource>(picked.length > 0 ? picked : ['skill'])
}

let cachedAll: AutocompleteItem[] | null = null
let cachedAuto: AutocompleteItem[] | null = null

export default function(pi: ExtensionAPI) {
  pi.on('session_start', (_event, ctx) => {
    if (typeof ctx.ui.addAutocompleteProvider !== 'function') return

    const autoChars = loadAutoTriggerChars()
    const autoSources = loadAutoSources()
    /** 句中 token 集合：自动触发符 + '/'（手动）；不匹配行首（行首由内置处理） */
    const midTokenRe = autoChars.length > 0
      ? new RegExp(`\\s([${autoChars.map(escapeRe).join('')}/]\\S*)$`)
      : /\s(\/\S*)$/
    const tokenStartRe = new RegExp(`^[${autoChars.map(escapeRe).join('')}/]`)
    const autoTokenStartRe = new RegExp(`^[${autoChars.map(escapeRe).join('')}]`)

    ctx.ui.addAutocompleteProvider((current): AutocompleteProvider => {
      const toItems = (autoOnly: boolean): AutocompleteItem[] => {
        if (!autoOnly) {
          if (!cachedAll) {
            cachedAll = pi.getCommands().map(cmd => ({
              value: cmd.name,
              label: cmd.name,
              ...(cmd.description ? { description: cmd.description } : {}),
            }))
          }
          return cachedAll
        }
        if (!cachedAuto) {
          cachedAuto = pi.getCommands()
            .filter(cmd => autoSources.has(cmd.source))
            .map(cmd => ({
              value: cmd.name,
              label: cmd.name,
              ...(cmd.description ? { description: cmd.description } : {}),
            }))
        }
        return cachedAuto
      }

      return {
        triggerCharacters: Array.from(new Set([...autoChars, ...(current.triggerCharacters ?? ['@', '#'])])),

        async getSuggestions(lines, cursorLine, cursorCol, options) {
          const before = (lines[cursorLine] ?? '').slice(0, cursorCol)
          debug('getSuggestions', JSON.stringify(before), 'force:', options.force)

          // 行首 /（当前行以 / 开头）→ 内置原路径（命令名 + 参数补全）
          if (before.startsWith('/')) {
            return current.getSuggestions(lines, cursorLine, cursorCol, options)
          }

          const match = before.match(midTokenRe)
          if (!match) {
            return current.getSuggestions(lines, cursorLine, cursorCol, options)
          }

          const token = match[1]
          const query = token.slice(1).toLowerCase()
          // $ 自动触发通道只补 autoSources（缺省仅 skill）；/ + Tab 手动通道补全全部
          const items = toItems(autoTokenStartRe.test(token)).filter((item) => item.value.toLowerCase().includes(query))
          if (items.length === 0) return null
          return { items, prefix: token }
        },

        applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
          // 非句中命令 token（@ 文件 / 引号路径 / 含子斜杠的路径前缀）→ 内置处理
          if (!tokenStartRe.test(prefix) || prefix.slice(1).includes('/') || prefix.startsWith('@') || prefix.startsWith('"')) {
            return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix)
          }

          // 命令替换：token（/xx 或 <触发符>xx）统一替换为 "/命令 "，光标移到末尾
          const line = lines[cursorLine] ?? ''
          const beforePrefix = line.slice(0, cursorCol - prefix.length)
          const afterCursor = line.slice(cursorCol)
          const newLines = [...lines]
          newLines[cursorLine] = `${beforePrefix}/${item.value} ${afterCursor}`
          return {
            lines: newLines,
            cursorLine,
            cursorCol: beforePrefix.length + item.value.length + 2,
          }
        },
      }
    })
  })

  /** 切换/新建 session 时命令集可能变化，清缓存 */
  pi.on('session_start', () => {
    cachedAll = null
    cachedAuto = null
  })
}

/** 正则字符类转义 */
function escapeRe(char: string): string {
  return char.replace(/[\\\]^|-]/g, '\\$&')
}
