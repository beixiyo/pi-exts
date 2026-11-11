import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { AutocompleteItem, AutocompleteProvider } from '@earendil-works/pi-tui'
import { homedir } from 'node:os'
import type { SymbolReferenceConfig } from './config'
import { parseSymbols, toItems } from './symbols'

function debounce(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve(false)
    const finish = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve(!signal.aborted)
    }
    const timer = setTimeout(finish, ms)
    signal.addEventListener('abort', finish, { once: true })
  })
}

// 取消等待与进程退出分离；仍接住迟到的 reject，避免阻塞宿主串行补全队列
function abortable<T>(task: Promise<T>, signal: AbortSignal): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const abort = () => resolve(undefined)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    task.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

// 单次解释配置中的路径、环境变量和模板标记，不递归展开替换值或查询文本
function expandCommandArgument(arg: string, values: Record<string, string>): string {
  return arg.replace(
    /^~(?=\/|$)|\$\$|\$(?:\{([A-Za-z_]\w*)\}|([A-Za-z_]\w*))|\{(\w+)\}/g,
    (token, bracedEnv: string | undefined, bareEnv: string | undefined, key: string | undefined) => {
      if (token === '~') return homedir()
      if (token === '$$') return '$'
      const envName = bracedEnv ?? bareEnv
      return envName === undefined ? values[key!] ?? token : process.env[envName] ?? token
    },
  )
}

function tokenAt(lines: string[], line: number, col: number): string | undefined {
  const before = (lines[line] ?? '').slice(0, col)
  const match = before.match(/(?:^|[ \t])#([^\s#"'`]*)$/)
  if (!match) return undefined
  const prefix = `#${match[1]}`
  // 不接管 @"包含空格 #xxx" 这样的未闭合引号路径
  if ((before.slice(0, before.length - prefix.length).match(/"/g)?.length ?? 0) % 2 !== 0) return undefined
  return prefix
}

/** 包装补全链；拥有防抖计时器和 CLI 请求，dispose 可重复调用 */
export function createSymbolProvider(current: AutocompleteProvider, options: SymbolProviderOptions): {
  provider: AutocompleteProvider
  dispose: () => void
} {
  const { config, cwd, exec, onError } = options
  let active: AbortController | undefined
  let disposed = false
  const ownedItems = new WeakSet<AutocompleteItem>()

  const dispose = () => {
    disposed = true
    active?.abort()
    active = undefined
  }

  return {
    dispose,
    provider: {
      triggerCharacters: [...new Set([...(current.triggerCharacters ?? ['@', '#']), '#'])],
      async getSuggestions(lines, line, col, request) {
        active?.abort()
        active = undefined
        const prefix = tokenAt(lines, line, col)
        if (prefix === undefined) return current.getSuggestions(lines, line, col, request)
        if (disposed || request.signal.aborted || prefix.length === 1) return null

        const controller = new AbortController()
        active = controller
        const abort = () => controller.abort()
        request.signal.addEventListener('abort', abort, { once: true })

        try {
          if (!await debounce(config.debounceMs, controller.signal)) return null
          const values = { cwd, query: prefix.slice(1), limit: String(config.maxResults) }
          const [command, ...args] = config.command.map((arg) => expandCommandArgument(arg, values))

          // 新版 pi 支持 maxBuffer；旧版忽略此字段，因此返回后仍限制可解析的输出大小
          const execOptions = { cwd, signal: controller.signal, timeout: config.timeoutMs, maxBuffer: 1024 * 1024 }
          const result = await abortable(exec(command!, args, execOptions), controller.signal)

          if (!result || controller.signal.aborted) return null
          const truncated = 'truncated' in result && result.truncated === true
          if (result.code !== 0 || result.killed || truncated) {
            let details = result.stderr.trim()
            if (!details && !truncated && Buffer.byteLength(result.stdout, 'utf8') <= execOptions.maxBuffer) {
              try {
                const failure = JSON.parse(result.stdout) as { error?: { message?: unknown } } | null
                if (typeof failure?.error?.message === 'string') details = failure.error.message.trim()
              }
              catch {
                // 外部 CLI 不一定输出 JSON，保留通用退出状态作为回退
              }
            }
            throw new Error(
              details.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').slice(0, 300)
                || `CLI failed (exit ${result.code}, killed: ${result.killed}, truncated: ${truncated})`,
            )
          }

          if (Buffer.byteLength(result.stdout, 'utf8') > execOptions.maxBuffer) throw new Error('CLI output exceeds 1 MiB')
          const items = toItems(parseSymbols(result.stdout), { cwd, template: config.insertTemplate, limit: config.maxResults })
          for (const item of items) ownedItems.add(item)

          return items.length ? { prefix, items } : null
        }
        catch (error) {
          if (!controller.signal.aborted) onError(error instanceof Error ? error.message : String(error))
          return null
        }
        finally {
          request.signal.removeEventListener('abort', abort)
          if (active === controller) active = undefined
        }
      },
      applyCompletion(lines, line, col, item, prefix) {
        if (!ownedItems.has(item)) return current.applyCompletion(lines, line, col, item, prefix)
        const text = lines[line] ?? ''
        const before = text.slice(0, col - prefix.length)
        const updated = [...lines]
        updated[line] = `${before}${item.value} ${text.slice(col)}`
        return { lines: updated, cursorLine: line, cursorCol: before.length + item.value.length + 1 }
      },
      shouldTriggerFileCompletion(lines, line, col) {
        if (tokenAt(lines, line, col) !== undefined) return false
        return current.shouldTriggerFileCompletion?.(lines, line, col) ?? true
      },
    },
  }
}

/** 补全 provider 的依赖与会话上下文 */
export interface SymbolProviderOptions {
  config: SymbolReferenceConfig
  cwd: string
  exec: ExtensionAPI['exec']
  onError: (message: string) => void
}
