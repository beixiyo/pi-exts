/**
 * /status 元信息采集：会话文件、恢复命令、git 分支、模型与上下文用量
 */
import type { ExtensionAPI, ExtensionCommandContext } from '@earendil-works/pi-coding-agent'
import { getAgentDir } from '@earendil-works/pi-coding-agent'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { StatusData } from './card'

/** 路径显示缩写：$HOME → ~ */
function shortenPath(path: string, home: string): string {
  return path === home ? '~' : path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}

/** 含空白路径加引号（对齐 pi 内置 formatResumeCommand 的 shell 安全习惯） */
function quoteIfNeeded(text: string): string {
  return /\s/.test(text) ? `"${text}"` : text
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

/** 收集当前会话元信息；git 分支查询失败静默跳过 */
export async function collectStatus(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<StatusData> {
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

  const rows = [
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
