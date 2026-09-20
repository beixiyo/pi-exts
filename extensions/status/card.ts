/**
 * /status 状态卡片：entry 渲染与行对齐
 */
import type { Theme } from '@earendil-works/pi-coding-agent'
import { Box, Text, visibleWidth } from '@earendil-works/pi-tui'

/** 卡片行定义：label 对齐后与 value 一起渲染 */
export interface StatusRow {
  label: string
  value: string
  /** accent 高亮（恢复命令等关键行） */
  highlight?: boolean
}

/** 卡片 entry 的持久化数据 */
export interface StatusData {
  rows: StatusRow[]
  /** 等价纯文本（/status copy 时也用它） */
  plainText: string
}

const LABEL_WIDTH = 12

/** label 按显示宽度右侧补空格，中文标签也可对齐 */
function padLabel(label: string): string {
  const width = visibleWidth(label)
  return width >= LABEL_WIDTH ? label : label + ' '.repeat(LABEL_WIDTH - width)
}

/** 渲染持久卡片（不进 LLM 上下文，仅 TUI 显示） */
export function renderStatusCard(data: StatusData, theme: Theme): Box {
  const box = new Box(1, 1)
  box.addChild(new Text(theme.fg('accent', theme.bold('Session Status')), 0, 0))
  box.addChild(new Text('', 0, 0))
  for (const row of data.rows) {
    const label = theme.fg('dim', padLabel(row.label))
    const value = row.highlight ? theme.fg('accent', row.value) : row.value
    box.addChild(new Text(` ${label}  ${value}`, 0, 0))
  }
  return box
}
