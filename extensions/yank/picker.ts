/**
 * /yank 选择器对话框：模式切换、模糊过滤、树形展开、复制选中
 */
import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent'
import { DynamicBorder, getSelectListTheme } from '@earendil-works/pi-coding-agent'
import { Container, fuzzyFilter, SelectList, Text } from '@earendil-works/pi-tui'
import { CONFIG, MODES, type YankMode } from './config'
import { toDisplay, visibleUnits } from './display'
import type { YankUnit } from './history'

/** 弹出选择器；返回选中的单元，取消返回 null */
export function pickUnit(ctx: ExtensionCommandContext, units: YankUnit[]): Promise<YankUnit | null> {
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
