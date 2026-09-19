/**
 * 会话消息工具（扩展共享）
 */

/** 从 message.content 提取纯文本（string 或 text parts 数组两种形态，parts 以 \n 连接） */
export function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((p): p is { type: 'text'; text: string } => !!p && typeof p === 'object' && (p as { type?: string }).type === 'text')
    .map((p) => p.text)
    .join('\n')
}
