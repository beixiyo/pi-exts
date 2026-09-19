/**
 * Status — /status 查看当前会话的各项元信息，方便接力（resume / 移交）
 *
 * 在聊天记录中追加一张持久卡片（appendEntry + 自定义渲染，不进 LLM 上下文）：
 * 会话名 / Session ID / 会话文件 / 恢复命令 / 工作目录 / git 分支 /
 * 模型与思考级别 / 上下文用量 / pi 存储位置
 *
 * /status   显示卡片，并默认把等价纯文本复制到剪贴板（接力时直接粘贴）
 *
 * ## 配置（settings.json 的 statusCard 键，可省略）
 *   {
 *     "statusCard": {
 *       "copyToClipboard": true    // /status 时是否自动复制纯文本到剪贴板
 *     }
 *   }
 */
import type { ExtensionAPI, ExtensionCommandContext, Theme } from '@earendil-works/pi-coding-agent'
import { getAgentDir } from '@earendil-works/pi-coding-agent'
import { Box, Text, visibleWidth } from '@earendil-works/pi-tui'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { copyText } from '../lib/clipboard'
import { readExtensionConfig } from '../lib/settings'

/** 卡片行定义：label 对齐后与 value 一起渲染 */
interface StatusRow {
  label: string
  value: string
  /** accent 高亮（恢复命令等关键行） */
  highlight?: boolean
}

/** /status 时是否自动复制纯文本（settings.statusCard.copyToClipboard，缺省 true） */
function copyEnabled(): boolean {
  return readExtensionConfig('statusCard')?.copyToClipboard !== false
}


/** 卡片 entry 的持久化数据 */
interface StatusData {
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

/** 路径显示缩写：$HOME → ~ */
function shortenPath(path: string, home: string): string {
  return path === home ? '~' : path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}

/** 含空白路径加引号（对齐 pi 内置 formatResumeCommand 的 shell 安全习惯） */
function quoteIfNeeded(text: string): string {
  return /\s/.test(text) ? `"${text}"` : text
}

/** 收集当前会话元信息；git 分支查询失败静默跳过 */
async function collectStatus(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<StatusData> {
  const sm = ctx.sessionManager
  const home = process.env.HOME ?? ''
  const sessionFile = sm.getSessionFile()
  const sessionDir = sm.getSessionDir()
  const sessionId = sm.getSessionId()
  const persisted = sessionFile !== undefined && existsSync(sessionFile)

  // 恢复命令：先 cd 到原工作目录（pi 会话绑定项目目录，跨目录启动会要求 fork），
  // 默认 session 目录省略 --session-dir，与 pi 退出时的提示一致
  const resumeParts = persisted
    ? [
      'cd',
      quoteIfNeeded(ctx.cwd),
      '&&',
      'pi',
      ...(sessionDir !== join(getAgentDir(), 'sessions')
        ? ['--session-dir', quoteIfNeeded(shortenPath(sessionDir, home))]
        : []),
      '--session',
      sessionId,
    ]
    : undefined
  const resumeCmd = resumeParts ? resumeParts.join(' ') : 'not persisted yet (created after first message)'

  // pi 存储位置（getAgentDir 处理 PI_AGENT_DIR 环境变量）
  const agentDir = shortenPath(getAgentDir(), home)

  const usage = ctx.getContextUsage()
  const contextText = usage?.percent === null || usage?.percent === undefined
    ? 'unknown (fresh compaction or no response yet)'
    : `${Math.round(usage.percent)}% used`

  const modelText = ctx.model
    ? `${ctx.model.provider}/${ctx.model.id}${ctx.thinkingLevel ? ` (thinking: ${ctx.thinkingLevel})` : ''}`
    : 'no model selected'

  const rows: StatusRow[] = [
    { label: 'Name', value: sm.getSessionName() ?? '(unnamed)' },
    { label: 'Session ID', value: sessionId },
    { label: 'Session file', value: persisted ? shortenPath(sessionFile!, home) : 'not persisted' },
    { label: 'Resume', value: resumeCmd, highlight: true },
    { label: 'cwd', value: ctx.cwd },
    { label: 'Model', value: modelText },
    { label: 'Context', value: contextText },
    { label: 'pi storage', value: agentDir },
  ]

  const gitBranch = await gitBranchOf(pi, ctx.cwd)
  if (gitBranch) rows.splice(5, 0, { label: 'Git branch', value: gitBranch })

  const plainText = [
    `session-name: ${sm.getSessionName() ?? '(unnamed)'}`,
    `session-id: ${sessionId}`,
    `session-file: ${persisted ? sessionFile : '(not persisted)'}`,
    `resume: ${resumeParts ? resumeParts.join(' ') : '(not persisted)'}`,
    `cwd: ${ctx.cwd}`,
    ...(gitBranch ? [`branch: ${gitBranch}`] : []),
    `model: ${modelText}`,
    `context: ${contextText}`,
    `agent-dir: ${agentDir}`,
  ].join('\n')

  return { rows, plainText }
}

/** 查询 cwd 的当前分支，非 git 仓库或失败返回 undefined */
async function gitBranchOf(pi: ExtensionAPI, cwd: string): Promise<string | undefined> {
  try {
    const result = await pi.exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, timeout: 3000 })
    if (result.code !== 0) return undefined
    const branch = result.stdout.trim()
    return branch === '' ? undefined : branch
  }
  catch {
    return undefined
  }
}

/** 渲染持久卡片（不进 LLM 上下文，仅 TUI 显示） */
function renderStatusCard(data: StatusData, theme: Theme): Box {
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

export default function(pi: ExtensionAPI) {
  pi.registerEntryRenderer('status-card', (entry, _opts, theme) => renderStatusCard(entry.data as StatusData, theme))

  pi.registerCommand('status', {
    description: 'Show session info (cwd, session file, resume command) and copy to clipboard for handoff',
    handler: async (_args, ctx) => {
      const data = await collectStatus(pi, ctx)

      // 默认复制（statusCard.copyToClipboard 可关），接力时直接粘贴即可；失败不阻断卡片展示
      if (copyEnabled()) {
        try {
          await copyText(data.plainText)
          if (ctx.hasUI) ctx.ui.notify('Session info copied to clipboard', 'info')
        }
        catch {
          if (ctx.hasUI) ctx.ui.notify('Copy failed (clipboard unavailable)', 'warning')
        }
      }

      if (ctx.hasUI) {
        pi.appendEntry('status-card', data)
      }
      else {
        ctx.ui.notify(data.plainText, 'info')
      }
    },
  })
}
