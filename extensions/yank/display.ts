/**
 * /yank 列表展示：摘要、条目文案、模式过滤与树形展开
 */
import type { SelectItem } from '@earendil-works/pi-tui'
import { truncateToWidth } from '@earendil-works/pi-tui'
import { CONFIG, type YankMode } from './config'
import type { YankUnit } from './history'

/** 单行摘要：压缩空白后按显示宽度截断 */
function summarize(text: string, width: number): string {
  return truncateToWidth(text.trim().replace(/\s+/g, ' '), width, '…')
}

export interface DisplayUnit {
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
export function toDisplay(units: YankUnit[], visible: DisplayUnit[]): SelectItem[] {
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
export function visibleUnits(units: YankUnit[], mode: YankMode, expanded: Set<number>, filter: string): { visible: DisplayUnit[]; scopedCount: number } {
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
