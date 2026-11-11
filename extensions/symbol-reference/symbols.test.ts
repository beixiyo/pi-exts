import { describe, expect, it } from 'vitest'
import { parseSymbols, toItems } from './symbols'

const options = { cwd: '/project', template: '#{name} {path}:{line}', limit: 50 }

describe('可替换 CLI 的 JSON 输出契约', () => {
  it('兼容 vv-mcp 文件 URI、同名不同位置和重复结果', () => {
    const parsed = parseSymbols(JSON.stringify({
      symbols: {
        'file:///project/a%20b.ts': [
          { name: 'foo', kind: 'Function', range: '3:2-5:1', container: 'Utils' },
          { name: 'foo', kind: 'Function', range: '3:2-5:1' },
          { name: 'foo', kind: 'Function', range: '9:1-10:1' },
          { name: 'unresolved' },
        ],
      },
    }))
    const items = toItems(parsed, options)
    expect(items.map((item) => item.value)).toEqual(['#foo a b.ts:3', '#foo a b.ts:9'])
    expect(items[0]!.description).toBe('Function · a b.ts:3 · Utils')
  })

  it('通用数组接受 1-based 行列、保留排序、限量，并支持自定义插入模板', () => {
    const parsed = parseSymbols(JSON.stringify([
      { name: 'first', path: 'a.ts', line: 2, character: 7, kind: 'Function' },
      { name: 'second', path: 'b.ts', line: 10 },
    ]))
    expect(toItems(parsed, { ...options, template: '{name} ({path}:{line}:{character})', limit: 1 })).toEqual([
      { label: 'first', value: 'first (a.ts:2:7)', description: 'Function · a.ts:2' },
    ])
  })

  it('不伪造缺失位置、不接受无效位置，输出剔除控制字符', () => {
    const parsed = parseSymbols(JSON.stringify([
      { name: 'bad', path: 'bad.ts', line: 0 },
      { name: 'missing', path: 'bad.ts' },
      { name: 'fraction', path: 'bad.ts', line: 1.5 },
      { name: 'bad column', path: 'bad.ts', line: 2, character: 0 },
      { name: 'foo\nbar', path: 'a.ts', line: 1, detail: '\u001b[31m' },
    ]))
    expect(parsed).toHaveLength(1)
    const [item] = toItems(parsed, options)
    expect(item!.value).toBe('#foo bar a.ts:1')
    expect(item!.description).not.toContain('\u001b')
  })

  it('合法空结果返回空数组，未知结构报错', () => {
    expect(parseSymbols('{"symbols":{}}')).toEqual([])
    expect(parseSymbols('[]')).toEqual([])
    expect(() => parseSymbols('{"items":[]}')).toThrow('Expected a symbol array')
  })
})
