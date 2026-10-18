/**
 * Slash Anywhere — 句中命令与 skill 补全（/ Tab 手动 + 触发符自动）
 *
 * pi 内置补全只在「当前行行首打 /」时给命令建议；pi-tui 的
 * setAutocompleteTriggerCharacters 显式过滤 '/'，扩展无法让句中 / 自动触发，
 * 因此提供两条触发通道（Codex 用 $、Claude Code 用句中 / 的折中）：
 * - 句中空白后或换行后行首打 <触发符>xxx → 自动弹层（默认 $，可配置；$ 不在过滤名单）
 * - 句中空白后打 /xxx 再按 Tab → 手动弹层（force 路径不受过滤影响）
 * - 建议来自 getCommands()（命令/prompt/skill），选中后统一替换为 "/命令 " 形态
 * - 行首 / 场景原样委托内置 provider，行为不变（含参数补全）
 *
 * 注：pi 只执行「整条消息以 / 开头」的命令；句中补全产物是文本引用（与 Claude Code 一致）
 *
 * 配置见 ./config.ts
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { AutocompleteItem, AutocompleteProvider } from '@earendil-works/pi-tui'
import { createDebug } from '../../lib/debug'
import { escapeRe, loadAutoSources, loadAutoTriggerChars } from './config'

const debug = createDebug('SLASH_DEBUG', '/tmp/slash-debug.log')

let cachedAll: AutocompleteItem[] | null = null
let cachedAuto: AutocompleteItem[] | null = null

export default function(pi: ExtensionAPI) {
  pi.on('session_start', (_event, ctx) => {
    if (typeof ctx.ui.addAutocompleteProvider !== 'function') return

    const autoChars = loadAutoTriggerChars()
    const autoSources = loadAutoSources()
    /** 句中 token 边界：空白或当前行行首（换行后的行首 pi-tui 也视为 token 边界并触发补全）；行首 '/' 由上方内置分支先行接管 */
    const midTokenRe = autoChars.length > 0
      ? new RegExp(`(?:^|\\s)([${autoChars.map(escapeRe).join('')}/]\\S*)$`)
      : /(?:^|\s)(\/\S*)$/
    const tokenStartRe = new RegExp(`^[${autoChars.map(escapeRe).join('')}/]`)
    const autoTokenStartRe = new RegExp(`^[${autoChars.map(escapeRe).join('')}]`)

    /** 未闭合引号前缀是否会被内置认可为引号路径（@"… 或位于 token 边界的 "…）：
     * 正文中间的孤引号（如 abc"def 后的 $token）内置不认，不应据此让路
     * 边界近似内置 isTokenStart：前字符为空白/引号/撇号/等号（内置还接受 CJK 标点边界，此处从简） */
    function unclosedQuoteAtBoundary(beforeToken: string): boolean {
      let inQuotes = false
      let quoteStart = -1
      for (let i = 0; i < beforeToken.length; i += 1) {
        if (beforeToken[i] === '"') {
          inQuotes = !inQuotes
          if (inQuotes) quoteStart = i
        }
      }
      if (!inQuotes) return false
      const at = beforeToken[quoteStart - 1] === '@' ? quoteStart - 1 : quoteStart
      return at === 0 || /[\s"'=]/u.test(beforeToken[at - 1] ?? '')
    }

    ctx.ui.addAutocompleteProvider((current): AutocompleteProvider => {
      const toItems = (autoOnly: boolean): AutocompleteItem[] => {
        if (!autoOnly) {
          if (!cachedAll) {
            cachedAll = pi.getCommands().map((cmd) => ({
              value: cmd.name,
              label: cmd.name,
              ...(cmd.description ? { description: cmd.description } : {}),
            }))
          }
          return cachedAll
        }
        if (!cachedAuto) {
          cachedAuto = pi.getCommands()
            .filter((cmd) => autoSources.has(cmd.source))
            .map((cmd) => ({
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
          const match = before.match(midTokenRe)
          const token = match?.[1]

          // 句中 token 形态判定（与 applyCompletion 的路径委托条件对称）：
          // - pathLike：token 含子斜杠（$docs/、~/Doc），是路径前缀而非命令引用
          // - quoted：token 前有未闭合引号，处于引号文本或 @"... 跨空格引号路径内部，
          //   内置对这类 token 有完整文件补全，接管会破坏路径
          const beforeToken = token ? before.slice(0, before.length - token.length) : ''
          const pathLike = token !== undefined && token.slice(1).includes('/')
          const quoted = unclosedQuoteAtBoundary(beforeToken)
          // 句中自动 token：<触发符> 开头（/ 属手动通道）、非路径、不在引号内
          const autoToken = token !== undefined && autoTokenStartRe.test(token) && !pathLike && !quoted

          // 行首 / 且当前 token 非句中自动 token → 内置原路径（命令名 + 参数补全）
          // 补全产物「/命令 」会让整行以 / 开头，其后继续打 <触发符> 仍属句中自动通道，不能被此分支吞掉
          if (before.startsWith('/') && !autoToken) {
            return current.getSuggestions(lines, cursorLine, cursorCol, options)
          }
          // 无 token，或 token 是路径子斜杠 / 引号内文本 → 内置文件与参数补全
          if (!match || pathLike || quoted) {
            return current.getSuggestions(lines, cursorLine, cursorCol, options)
          }

          const query = token!.slice(1).toLowerCase()
          // $ 自动触发通道只补 autoSources（缺省仅 skill）；/ + Tab 手动通道补全全部
          const items = toItems(autoToken).filter((item) => item.value.toLowerCase().includes(query))
          if (items.length === 0) return null
          return { items, prefix: token! }
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
