/**
 * slash-anywhere 配置读取与归一化
 *
 * ## 配置（~/.pi/agent/settings.json 的 slashAnywhere 键，可省略）
 *   {
 *     "slashAnywhere": {
 *       "autoTriggerChars": ["$"],   // 句中自动弹层的触发符；/ 始终走 Tab 手动触发
 *       "autoSources": ["skill"]     // $ 自动触发通道补全什么：extension | prompt | skill 任意组合
 *     }
 *   }
 */
import type { SlashCommandInfo } from '@earendil-works/pi-coding-agent'
import { readExtensionConfig } from '../../lib/settings'

/** 内置已占用的触发符（文件 @ / 引号 "），自定义时跳过 */
const RESERVED_CHARS = new Set(['@', '#', '"'])

/** 命令来源：扩展注册命令 / prompt 模板 / skill */
export type CommandSource = SlashCommandInfo['source']
const COMMAND_SOURCES: readonly CommandSource[] = ['extension', 'prompt', 'skill']

/** 配置归一化：单个非字母数字符号、去重、避开内置 */
export function loadAutoTriggerChars(): string[] {
  const raw = readExtensionConfig('slashAnywhere')?.autoTriggerChars
  if (!Array.isArray(raw)) return ['$']
  const chars = raw.filter((c): c is string =>
    typeof c === 'string' && c.length === 1 && /[^\w\s]/.test(c) && !RESERVED_CHARS.has(c))
  return [...new Set(chars)]
}

/** $ 自动触发通道的补全源（settings.slashAnywhere.autoSources，缺省仅 skill）
 * / + Tab 手动通道始终补全全部，不受此配置影响 */
export function loadAutoSources(): ReadonlySet<CommandSource> {
  const raw = readExtensionConfig('slashAnywhere')?.autoSources
  if (!Array.isArray(raw)) return new Set<CommandSource>(['skill'])
  const picked = raw.filter((s): s is CommandSource =>
    typeof s === 'string' && (COMMAND_SOURCES as readonly string[]).includes(s))
  return new Set<CommandSource>(picked.length > 0 ? picked : ['skill'])
}

/** 正则字符类转义 */
export function escapeRe(char: string): string {
  return char.replace(/[\\\]^|-]/g, '\\$&')
}
