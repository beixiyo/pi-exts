import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { loadConfig } from './config'
import { createSymbolProvider } from './provider'

/** # 项目符号引用：按需调用可替换的 CLI，不注册或依赖 MCP 服务 */
export default function(pi: ExtensionAPI) {
  let dispose: (() => void) | undefined
  pi.on('session_shutdown', () => {
    dispose?.()
    dispose = undefined
  })

  pi.on('session_start', (_event, ctx) => {
    dispose?.()
    dispose = undefined
    if (ctx.mode !== 'tui' || typeof ctx.ui.addAutocompleteProvider !== 'function') return

    try {
      const config = loadConfig({ cwd: ctx.cwd, projectTrusted: ctx.isProjectTrusted() })
      if (!config.enabled) return
      let errorShown = false

      ctx.ui.addAutocompleteProvider((current) => {
        const created = createSymbolProvider(current, {
          config,
          cwd: ctx.cwd,
          exec: (command, args, options) => pi.exec(command, args, options),
          onError: (message) => {
            if (errorShown) return
            errorShown = true
            ctx.ui.notify(`Symbol reference: ${message}`, 'warning')
          },
        })
        dispose?.()
        dispose = created.dispose
        return created.provider
      })
    }
    catch (error) {
      ctx.ui.notify(`Symbol reference: ${error instanceof Error ? error.message : String(error)}`, 'warning')
    }
  })
}
