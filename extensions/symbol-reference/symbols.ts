import type { AutocompleteItem } from '@earendil-works/pi-tui'
import { isAbsolute, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** 单次替换，避免把用户查询或符号名中的花括号再次解释为模板 */
export function expandTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match)
}

/** 解析通用数组或 vv-mcp 分组 JSON；位置均为 1-based，不猜测缺失的位置 */
export function parseSymbols(stdout: string): SymbolReference[] {
  const data: unknown = JSON.parse(stdout)
  const symbols: SymbolReference[] = []

  const append = (entry: unknown, groupedPath?: string) => {
    if (!record(entry)) return
    const path = groupedPath ?? entry.path
    const range = typeof entry.range === 'string' ? entry.range.match(/^(\d+):(\d+)-\d+:\d+$/) : null
    const line = entry.line ?? (range ? Number(range[1]) : undefined)
    const character = entry.character ?? (range ? Number(range[2]) : 1)

    if (
      typeof entry.name !== 'string' || !entry.name.trim() || typeof path !== 'string' || !path.trim()
      || typeof line !== 'number' || !Number.isSafeInteger(line) || line < 1
      || typeof character !== 'number' || !Number.isSafeInteger(character) || character < 1
    ) return
    symbols.push({
      name: entry.name,
      path: path.startsWith('file:') ? fileURLToPath(path) : path,
      line,
      character,
      kind: typeof entry.kind === 'string' ? entry.kind : '',
      container: typeof entry.container === 'string' ? entry.container : '',
      detail: typeof entry.detail === 'string' ? entry.detail : '',
    })
  }
  if (Array.isArray(data)) data.forEach((entry) => append(entry))
  else if (record(data) && record(data.symbols)) {
    for (const [path, entries] of Object.entries(data.symbols)) {
      if (Array.isArray(entries)) entries.forEach((entry) => append(entry, path))
    }
  }
  else throw new Error('Expected a symbol array or an object with grouped symbols')
  return symbols
}

/** 为候选生成相对路径描述和可定位的插入文本，按位置去重并保留工具排序 */
export function toItems(symbols: SymbolReference[], options: { cwd: string; template: string; limit: number }): AutocompleteItem[] {
  const seen = new Set<string>()
  const items: AutocompleteItem[] = []

  for (const symbol of symbols) {
    const key = JSON.stringify([symbol.path, symbol.line, symbol.character, symbol.name])
    if (seen.has(key)) continue
    seen.add(key)

    const path = isAbsolute(symbol.path) ? relative(options.cwd, symbol.path) : symbol.path
    const values = { ...symbol, path, line: String(symbol.line), character: String(symbol.character) }
    // 候选来自外部进程，不允许控制字符进入终端或编辑器文本
    const clean = (text: string) => text.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    items.push({
      value: clean(expandTemplate(options.template, values)),
      label: clean(symbol.name),
      description: clean([symbol.kind, `${path}:${symbol.line}`, symbol.container, symbol.detail].filter(Boolean).join(' · ')),
    })
    if (items.length >= options.limit) break
  }

  return items
}

/** CLI 归一化后的符号位置 */
export interface SymbolReference {
  name: string
  path: string
  line: number
  character: number
  kind: string
  container: string
  detail: string
}
