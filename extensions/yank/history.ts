/**
 * /yank 会话历史采集：轮次合并、代码块解析、可复制单元收集
 */
import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent'
import { extractText } from '../../lib/message'
import { CONFIG } from './config'

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

export interface YankUnit {
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
export function collectUnits(ctx: ExtensionCommandContext): YankUnit[] {
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
