/**
 * /yank — 从会话历史中精确复制内容到剪贴板
 *
 * 输入 /yank 弹出选择器（旧→新排列，最新在底部，默认选中最新一项），
 * Tab 在三种模式间循环切换：
 *
 * - answers：每轮 assistant 回复一项；→ 展开其代码块为缩进子项，← 收起
 *   （代码块属于该回答的子项，展开即下钻，Enter 仍复制当前项）
 * - codes：全部回复中的代码块平铺（跨回答搜索块）
 * - questions：每轮用户消息一项
 *
 *   ▾ 已完成 yank.ts 的重写…        A15 · 60 lines · 3 blocks
 *     │ ts     const MODES: …     A15 · #1 · 12 lines
 *   列表渲染是否能嵌套…             Q9 · 3 lines
 *
 * - ↑↓ 移动、Enter 复制选中项、Esc 取消（SelectList 原生支持鼠标点击）
 * - →/← 展开收起代码块（answers 模式，无 filter 时）
 * - Tab 切换模式；直接输入可打印字符 = 模糊过滤（label + description），
 *   Backspace 删除、C-u 清空；过滤时树退化为平铺
 * - 选中即复制原始内容，不增删任何字符（回答不含围栏，代码块不含首尾围栏行）
 *
 * 仅 TUI 模式；项数受 maxTurns / maxUnits 约束，防止超长会话卡顿
 *
 * ## 配置（settings.json 的 yank 键，整段可省略，省省即用默认值）
 *   {
 *     "yank": {
 *       "maxTurns": 20,        // 最多展示的消息轮数（各角色独立计数）
 *       "maxUnits": 300,       // 列表项总数上限
 *       "previewWidth": 48,    // label 首行摘要的显示宽度（列）
 *       "maxVisible": 12,      // 选择器一次可见行数
 *       "defaultMode": "answers"   // answers | codes | questions
 *     }
 *   }
 */
import type { ExtensionAPI, ExtensionCommandContext } from '@earendil-works/pi-coding-agent'
import { DynamicBorder, getSelectListTheme } from '@earendil-works/pi-coding-agent'
import { Container, fuzzyFilter, type SelectItem, SelectList, Text, truncateToWidth } from '@earendil-works/pi-tui'
import { copyText } from '../lib/clipboard'
import { extractText } from '../lib/message'
import { readExtensionConfig } from '../lib/settings'

// ════════════════════ 配置区 ════════════════════

/** 列表模式：回答（可展开代码块）/ 代码块 / 用户问题 */
type YankMode = 'answers' | 'codes' | 'questions'

/** Tab 循环顺序与显示名 */
const MODES: readonly { key: YankMode; label: string }[] = [
  { key: 'answers', label: 'answers' },
  { key: 'codes', label: 'codes' },
  { key: 'questions', label: 'questions' },
]

/** 配置归一化：非法值回退默认（settings.yank） */
function loadConfig(): {
  maxTurns: number
  maxUnits: number
  previewWidth: number
  maxVisible: number
  defaultMode: YankMode
} {
  const cfg = readExtensionConfig('yank')
  const int = (key: string, fallback: number): number => {
    const value = cfg?.[key]
    return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback
  }
  const mode = cfg?.defaultMode
  return {
    maxTurns: int('maxTurns', 20),
    maxUnits: int('maxUnits', 300),
    previewWidth: int('previewWidth', 48),
    maxVisible: int('maxVisible', 12),
    defaultMode: mode === 'codes' || mode === 'questions' ? mode : 'answers',
  }
}

/** 列表当前生效配置（扩展加载时读取，改 settings 后 /reload 或下会话生效） */
const CONFIG = loadConfig()

// ════════════════════ 实现 ════════════════════

interface CodeBlock {
  lang: string
  code: string
  firstLine: string
  lineCount: number
}

/** 解析 markdown 围栏代码块（``` / ~~~，≥3 个字符）；未闭合的尾块也收下 */
function parseCodeBlocks(text: string): CodeBlock[] {
  const blocks: CodeBlock[] = []
  let lang = ''
  let fenceChar = ''
  let fenceLen = 0
  let buf: string[] | null = null

  const push = () => {
    if (!buf) return
    while (buf.length > 0 && buf[buf.length - 1] === '') buf.pop()
    const code = buf.join('\n')
    if (code.trim()) {
      blocks.push({
        lang,
        code,
        firstLine: (code.split('\n').find((l) => l.trim()) ?? '').trim(),
        lineCount: buf.length,
      })
    }
  }

  for (const line of text.split('\n')) {
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (buf === null) {
      if (m) {
        fenceChar = m[1]![0]!
        fenceLen = m[1]!.length
        lang = m[2]!.trim().split(/\s+/)[0] ?? ''
        buf = []
      }
    }
    else if (m && m[1]![0] === fenceChar && m[1]!.length >= fenceLen && !m[2]!.trim()) {
      push()
      buf = null
    }
    else {
      buf.push(line)
    }
  }
  push()
  return blocks
}

interface YankUnit {
  text: string
  kind: 'question' | 'answer' | 'code'
  lang: string
  lineCount: number
  /** 首个非空行，仅用于 label 预览 */
  firstLine: string
  /** 轮次标签：An / Qn（各角色独立计数，1 = 最早） */
  turnLabel: string
  /** answer 自身或 code 所属 answer 的序列号（展开分组键） */
  seq: number
  /** code 单元：所属回答内序号（1 起）；answer 单元：代码块总数 */
  blockIndex?: number
  blockCount?: number
}

/** 会话轮次：连续同角色 message（工具往返产生的碎片）合并为一轮 */
interface Turn {
  role: 'user' | 'assistant'
  text: string
}

/** 将 branch 中的 message entry 按角色合并为完整轮次（最新在末尾）
 * 一轮带工具调用的回复在 session 里是多条连续 assistant entry
 * （每次工具往返前的文字片段 + 收尾文本），中间夹着 toolResult 等
 * 非 user/assistant entry；不合并的话轮次编号会被碎片严重虚高 */
function collectTurns(ctx: ExtensionCommandContext): Turn[] {
  const turns: Turn[] = []
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== 'message') continue
    const message = (entry as { message?: { role?: string; content?: unknown } }).message
    if (message?.role !== 'user' && message?.role !== 'assistant') continue
    const text = extractText(message.content).trim()
    if (!text) continue
    const last = turns[turns.length - 1]
    if (last && last.role === message.role) last.text += `\n\n${text}`
    else turns.push({ role: message.role, text })
  }
  return turns
}

/** 收集可复制单元：按时间正序（最新在底部）；问题/回答各自独立编号 */
function collectUnits(ctx: ExtensionCommandContext): YankUnit[] {
  const units: YankUnit[] = []
  let questionSeq = 0
  let answerSeq = 0

  for (const { role, text } of collectTurns(ctx)) {
    const firstLine = (text.split('\n').find((l) => l.trim()) ?? '').trim()
    const lineCount = text.split('\n').length

    if (role === 'user') {
      questionSeq += 1
      units.push({ text, kind: 'question', lang: '', lineCount, firstLine, turnLabel: `Q${questionSeq}`, seq: questionSeq })
    }
    else {
      answerSeq += 1
      const blocks = parseCodeBlocks(text)
      units.push({ text, kind: 'answer', lang: '', lineCount, firstLine, turnLabel: `A${answerSeq}`, seq: answerSeq, blockCount: blocks.length })
      for (const [k, block] of blocks.entries()) {
        units.push({
          text: block.code,
          kind: 'code',
          lang: block.lang,
          lineCount: block.lineCount,
          firstLine: block.firstLine,
          turnLabel: `A${answerSeq}`,
          seq: answerSeq,
          blockIndex: k + 1,
        })
      }
    }
  }

  // 截旧保新：各角色只保留最近 maxTurns 轮；项数超限时同样丢弃最旧项
  const isRecent = (u: YankUnit) =>
    u.kind === 'question'
      ? u.seq > questionSeq - CONFIG.maxTurns
      : u.seq > answerSeq - CONFIG.maxTurns
  return units.filter(isRecent).slice(-CONFIG.maxUnits)
}

/** 单行摘要：压缩空白后按显示宽度截断 */
function summarize(text: string, width: number): string {
  return truncateToWidth(text.trim().replace(/\s+/g, ' '), width, '…')
}

interface DisplayUnit {
  unit: YankUnit
  /** answers 模式下该单元是否为展开状态下的回答项 */
  expanded?: boolean
  /** answers 模式下是否为缩进子项（代码块） */
  child?: boolean
}

/** 展开指示（与 nvim vv-explorer 同款：vv-icons 的 fold_closed / fold_open chevron）
 * 有子块的回答项 2 列槽（chevron + 空格），无子块回答项纯空格对齐 */
const CHEVRON_CLOSED = '\uf460'
const CHEVRON_OPEN = '\uf47c'

/** 列表项文案（英文）；value 放 units 索引而非文本（避免超长 value 干扰） */
function toDisplay(units: YankUnit[], visible: DisplayUnit[]): SelectItem[] {
  return visible.map(({ unit, expanded, child }) => {
    const label = unit.kind === 'code'
      ? `${child ? '  │ ' : '  '}${(unit.lang || 'code').padEnd(7)} ${summarize(unit.firstLine, CONFIG.previewWidth - 9)}`
      // 回答项仅保留功能性展开指示；模式由顶部 mode 行表达，不再重复「Answer」前缀
      : `${unit.blockCount ? (expanded ? CHEVRON_OPEN : CHEVRON_CLOSED) + ' ' : '  '}${summarize(unit.firstLine, CONFIG.previewWidth)}`
    const description = unit.kind === 'code'
      ? `${unit.turnLabel} · #${unit.blockIndex} · ${unit.lineCount} lines`
      : unit.kind === 'question'
      ? `${unit.turnLabel} · ${unit.lineCount} lines`
      : `${unit.turnLabel} · ${unit.lineCount} lines${unit.blockCount ? ` · ${unit.blockCount} blocks` : ''}`
    return { value: String(units.indexOf(unit)), label, description }
  })
}

/** 当前模式的可见单元序列（answers 模式按展开状态组树） */
function visibleUnits(units: YankUnit[], mode: YankMode, expanded: Set<number>, filter: string): { visible: DisplayUnit[]; scopedCount: number } {
  if (mode === 'codes') {
    const scoped = units.filter((u) => u.kind === 'code')
    return { visible: scoped.map((unit) => ({ unit })), scopedCount: scoped.length }
  }
  if (mode === 'questions') {
    const scoped = units.filter((u) => u.kind === 'question')
    return { visible: scoped.map((unit) => ({ unit })), scopedCount: scoped.length }
  }

  // answers：回答 + 展开项的子代码块；有 filter 时树退化为平铺（全展开）
  const visible: DisplayUnit[] = []
  let scopedCount = 0
  for (const unit of units) {
    if (unit.kind !== 'answer') continue
    scopedCount += 1
    const open = filter ? true : expanded.has(unit.seq)
    visible.push({ unit, expanded: open })
    if (open && unit.blockCount) {
      for (const child of units) {
        if (child.kind === 'code' && child.seq === unit.seq) visible.push({ unit: child, child: true })
      }
    }
  }
  return { visible, scopedCount }
}

/** 弹出选择器；返回选中的单元，取消返回 null */
async function pickUnit(ctx: ExtensionCommandContext, units: YankUnit[]): Promise<YankUnit | null> {
  return ctx.ui.custom<YankUnit | null>((tui, theme, _kb, done) => {
    let mode: YankMode = CONFIG.defaultMode
    let filter = ''
    let expanded = new Set<number>()
    let list: SelectList

    const container = new Container()
    const topBorder = new DynamicBorder((s: string) => theme.fg('accent', s))
    const title = new Text(theme.fg('accent', theme.bold(' Yank — pick content to copy')), 1, 0)
    const help = new Text(theme.fg('dim', ' ↑↓ select · ←→ expand · Tab mode · type filter · ⌃U clear · ⏎ copy · esc cancel'), 1, 0)
    const bottomBorder = new DynamicBorder((s: string) => theme.fg('accent', s))

    /** 依据当前模式 + 展开状态 + filter 重建列表与状态行
     * keepValue：展开/收起后需保持选中的单元（units 索引字符串），
     * 避免每次重建都落到默认位置把光标甩到底部 */
    const rebuild = (keepValue?: string) => {
      container.clear()
      container.addChild(topBorder)
      container.addChild(title)

      const { visible, scopedCount } = visibleUnits(units, mode, expanded, filter)
      const items = toDisplay(units, visible)
      const shown = filter
        ? fuzzyFilter(items, filter, (item) => `${item.label} ${item.description ?? ''}`)
        : items

      const modeLabel = MODES.find((m) => m.key === mode)?.label ?? mode
      container.addChild(new Text(theme.fg('accent', ` mode: ${modeLabel} (${scopedCount})`), 1, 0))

      list = new SelectList(shown, CONFIG.maxVisible, getSelectListTheme())
      list.onSelect = (item) => done(units[Number(item.value)] ?? null)
      list.onCancel = () => done(null)
      // 优先还原 keepValue 指定的选中项；否则无过滤时默认选中最新一项
      // （该模式最后一个主项，过滤后从头开始）
      const kept = keepValue !== undefined ? shown.findIndex((item) => item.value === keepValue) : -1
      if (kept >= 0) {
        list.setSelectedIndex(kept)
      }
      else if (!filter && shown.length > 0) {
        let target = shown.length - 1
        if (mode === 'answers') {
          const lastAnswer = [...shown].reverse().find((item) => units[Number(item.value)]?.kind === 'answer')
          if (lastAnswer) target = shown.indexOf(lastAnswer)
        }
        list.setSelectedIndex(target)
      }
      container.addChild(list)

      container.addChild(
        filter
          ? new Text(theme.fg('accent', ` filter: ${filter}`), 1, 0)
          : new Text(theme.fg('dim', ` ${units.length} items`), 1, 0),
      )
      container.addChild(help)
      container.addChild(bottomBorder)
    }
    rebuild()

    /** →/← 切换展开（answers 模式且无 filter 时）；返回重建后需保持选中的项：
     * 回答项上 →/← 展开/收起并保持选中；代码块上 ← 收起其父回答并选中父项 */
    const toggleExpand = (open: boolean): string | undefined => {
      const selected = list.getSelectedItem()
      if (!selected) return undefined
      const unit = units[Number(selected.value)]
      if (unit?.kind === 'answer' && unit.blockCount) {
        if (open) expanded.add(unit.seq)
        else expanded.delete(unit.seq)
        return selected.value
      }
      if (unit?.kind === 'code' && !open) {
        expanded.delete(unit.seq)
        const parent = units.findIndex((u) => u.kind === 'answer' && u.seq === unit.seq)
        return parent >= 0 ? String(parent) : undefined
      }
      return undefined
    }

    return {
      render: (width: number) => container.render(width),
      invalidate: () => container.invalidate(),
      handleInput: (data: string) => {
        if (data === '\t') {
          const index = MODES.findIndex((m) => m.key === mode)
          mode = MODES[(index + 1) % MODES.length]!.key
          filter = ''
        }
        else if (data === '\x1b[C' || data === '\x1b[D') {
          if (mode === 'answers' && !filter) {
            const keep = toggleExpand(data === '\x1b[C')
            if (keep !== undefined) {
              rebuild(keep)
              tui.requestRender()
              return
            }
          }
        }
        else if (data === '\x7f') {
          filter = filter.slice(0, -1)
        }
        else if (data === '\x15') {
          filter = ''
        }
        else if (data && !/[\x00-\x1f\x7f-\x9f]/.test(data)) {
          filter += data
        }
        else {
          list.handleInput(data)
          tui.requestRender()
          return
        }
        rebuild()
        tui.requestRender()
      },
    }
  })
}

export default function(pi: ExtensionAPI) {
  pi.registerCommand('yank', {
    description: 'Copy a reply, code block, or user question from the conversation',
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify('/yank requires TUI mode', 'warning')
        return
      }

      const units = collectUnits(ctx)
      if (units.length === 0) {
        ctx.ui.notify('Nothing to copy yet', 'warning')
        return
      }

      const chosen = await pickUnit(ctx, units)
      if (!chosen) return

      const what = chosen.kind === 'code'
        ? `${chosen.turnLabel} · code block ${chosen.lang || 'code'} · ${chosen.lineCount} lines`
        : `${chosen.turnLabel} · ${chosen.kind === 'question' ? 'question' : 'answer'} · ${chosen.lineCount} lines`
      try {
        await copyText(chosen.text)
        ctx.ui.notify(`Copied: ${what}`, 'info')
      }
      catch (err) {
        ctx.ui.notify(`Copy failed: ${err instanceof Error ? err.message : String(err)}`, 'error')
      }
    },
  })
}
