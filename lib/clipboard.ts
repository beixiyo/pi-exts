/**
 * 剪贴板读写（扩展共享工具）
 *
 * 写入：tmux 内走 `tmux load-buffer -w -`（stdin 灌入，无参数长度限制）：
 * 由 tmux 把内容经 OSC 52 转发到真实 client 所在终端——SSH attach 场景下
 * pi 内置 copyToClipboard 依赖 SSH_CONNECTION 判定远程，而旧 tmux server 的
 * pane 环境缺失该变量，会把内容留在远端机器的本地剪贴板；
 * 非 tmux 或 tmux 失败时回退 pi 内置实现
 *
 * 读取：经 pi-tui native 剪贴板（macOS/Windows 预编译模块，Linux 由其内部
 * 回退 wl-paste/xclip）；图片落盘时做格式检测，不支持格式（如 BMP）转 PNG，
 * 与 pi 主输入框的 ctrl+v 贴图行为一致
 */
import { convertToPng, copyToClipboard, detectSupportedImageMimeTypeFromFile } from '@earendil-works/pi-coding-agent'
import { getNativeClipboard } from '@earendil-works/pi-tui'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { rename, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

/** 支持的图片 mime → 扩展名（与 pi 主输入框附件格式一致） */
const IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/** 读取系统剪贴板文本；无文本、平台无 native 剪贴板或读取失败返回 null */
export async function readClipboardText(): Promise<string | null> {
  const clipboard = getNativeClipboard()
  if (!clipboard) return null
  try {
    return await clipboard.getText() ?? null
  }
  catch {
    return null
  }
}

/**
 * 把系统剪贴板图片保存为临时文件并返回路径；剪贴板无图片、格式不支持且
 * 转 PNG 失败、或平台无 native 剪贴板时返回 null
 *
 * 文件名与主输入框 ctrl+v 贴图一致（`pi-clipboard-<uuid>.<ext>`，位于 os.tmpdir()），
 * 调用方拿到路径后作为文本插入即可被会话识别为图片附件
 */
export async function saveClipboardImageToTemp(): Promise<string | null> {
  const clipboard = getNativeClipboard()
  if (!clipboard) return null

  let bytes: Uint8Array | null | undefined
  try {
    bytes = await clipboard.getImage()
  }
  catch {
    return null
  }
  if (!bytes || bytes.length === 0) return null

  const staging = join(tmpdir(), `pi-clipboard-${randomUUID()}`)
  try {
    await writeFile(staging, bytes)
    let mime = await detectSupportedImageMimeTypeFromFile(staging)
    if (!mime) {
      // 不支持格式（如 Windows DIB/BMP）：尝试经 photon 转 PNG，失败则放弃
      const png = await convertToPng(Buffer.from(bytes).toString('base64'), 'application/octet-stream')
      if (!png) return null
      await writeFile(staging, Buffer.from(png.data, 'base64'))
      mime = await detectSupportedImageMimeTypeFromFile(staging)
    }
    const ext = mime ? IMAGE_EXTENSIONS[mime] : undefined
    if (!mime || !ext) return null
    const finalPath = `${staging}.${ext}`
    await rename(staging, finalPath)
    return finalPath
  }
  catch {
    await unlink(staging).catch(() => {}) // 已 rename 时不存在，忽略即可
    return null
  }
}
