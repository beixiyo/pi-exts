/**
 * 剪贴板写入（扩展共享工具）
 *
 * tmux 内走 `tmux load-buffer -w -`（stdin 灌入，无参数长度限制）：
 * 由 tmux 把内容经 OSC 52 转发到真实 client 所在终端——SSH attach 场景下
 * pi 内置 copyToClipboard 依赖 SSH_CONNECTION 判定远程，而旧 tmux server 的
 * pane 环境缺失该变量，会把内容留在远端机器的本地剪贴板；
 * 非 tmux 或 tmux 失败时回退 pi 内置实现
 *
 * 注：本目录无 index.ts，pi 扩展发现规则不会把 lib/ 当扩展加载
 */
import { copyToClipboard } from '@earendil-works/pi-coding-agent'
import { spawn } from 'node:child_process'

/** 复制文本到用户手边终端的剪贴板（tmux 经 OSC 52 转发，否则本机原生） */
export function copyText(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!process.env.TMUX) {
      void copyToClipboard(text).then(resolve, reject)
      return
    }
    const child = spawn('tmux', ['load-buffer', '-w', '-'], { stdio: ['pipe', 'ignore', 'ignore'] })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else void copyToClipboard(text).then(resolve, reject)
    })
    child.stdin.on('error', () => {}) // EPIPE 由 close code 兜底
    child.stdin.end(text)
  })
}
