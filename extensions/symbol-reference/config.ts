import { readExtensionConfig, type SettingsReadOptions } from '../../lib/settings'

/** 读取 symbolReference 配置；不可信项目不能覆盖可执行命令 */
export function loadConfig(options: SettingsReadOptions = {}): SymbolReferenceConfig {
  const raw = readExtensionConfig('symbolReference', options) ?? {}
  const command = raw.command === undefined
    ? ['vv-mcp', 'lsp', '--operation', 'workspace_symbols', '--uri', '{cwd}', '--query', '{query}', '--output-format', 'json', '--max-results', '{limit}']
    : raw.command
  if (!Array.isArray(command) || command.length === 0 || command.some((arg) => typeof arg !== 'string') || !command[0].trim()) {
    throw new Error('symbolReference.command must be a non-empty string array')
  }

  const number = (key: string, fallback: number, min: number) => {
    const value = raw[key]
    if (value === undefined) return fallback
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > 2_147_483_647) {
      throw new Error(`symbolReference.${key} must be an integer >= ${min}`)
    }
    return value
  }
  if (raw.insertTemplate !== undefined && (typeof raw.insertTemplate !== 'string' || !raw.insertTemplate.trim())) {
    throw new Error('symbolReference.insertTemplate must be a non-empty string')
  }

  return {
    enabled: raw.enabled !== false,
    command: command as string[],
    debounceMs: number('debounceMs', 80, 0),
    timeoutMs: number('timeoutMs', 30000, 1),
    maxResults: number('maxResults', 50, 1),
    insertTemplate: raw.insertTemplate as string | undefined ?? '#{name} {path}:{line}',
  }
}

/** 符号引用的 CLI 与补全策略 */
export interface SymbolReferenceConfig {
  /** 是否启用 @default true */
  enabled: boolean
  /** 可执行文件与独立参数，支持 ~、~/、$VAR、${VAR} 及 {cwd}、{query}、{limit}；默认调用 vv-mcp */
  command: string[]
  /** 查询防抖毫秒数 @default 80 */
  debounceMs: number
  /** CLI 超时毫秒数（含 headless 冷启动） @default 30000 */
  timeoutMs: number
  /** 最大候选数量 @default 50 */
  maxResults: number
  /** 插入文本模板 @default '#{name} {path}:{line}' */
  insertTemplate: string
}
