/** 将 Pi 的 KeyId 格式化为 vv-utils.keys 风格的紧凑提示，不改变实际键位绑定 */
import type { KeyId } from '@earendil-works/pi-tui'

const modifiers = [
  ['ctrl', '^'],
  ['alt', '⌥'],
  ['shift', '⇧'],
  ['super', '⌘'],
] as const

const specialKeys: Readonly<Record<string, string>> = {
  enter: '↵',
  return: '↵',
  escape: 'Esc',
  esc: 'Esc',
  tab: 'Tab',
  space: '␠',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
}

/** 格式化一组备选快捷键；按 ^⌥⇧⌘ 排序修饰键，保留 /、+ 等字面量键 */
export function formatKeys(keys: readonly KeyId[]): string {
  return [...new Set(keys.map(displayKey))].join(' / ')
}

/** 只剥离修饰键前缀，避免把 Ctrl+/ 或 Ctrl++ 中的主键当分隔符 */
function displayKey(value: KeyId): string {
  let key: string = value
  const active = new Set<string>()
  while (true) {
    const match = /^(ctrl|alt|shift|super)\+(.+)$/.exec(key)
    if (!match) break
    active.add(match[1]!)
    key = match[2]!
  }
  const prefix = modifiers.filter(([name]) => active.has(name)).map(([, symbol]) => symbol).join('')
  const label = specialKeys[key] ?? (key.length === 1
    ? (active.has('shift') ? key.toUpperCase() : key.toLowerCase())
    : key[0]!.toUpperCase() + key.slice(1))
  return prefix + label
}
