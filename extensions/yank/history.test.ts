/**
 * parseCodeBlocks 契约测试
 *
 * 捕获的失败面：围栏解析边界出错 → /yank 展示/复制的内容与原文不符
 */
import { describe, expect, it } from 'vitest'
import { parseCodeBlocks } from './history'

describe('parseCodeBlocks', () => {
  it('解析标准 ``` 围栏与语言标注', () => {
    const blocks = parseCodeBlocks('before\n```ts\nconst a = 1\n```\nafter')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.lang).toBe('ts')
    expect(blocks[0]!.code).toBe('const a = 1')
    expect(blocks[0]!.firstLine).toBe('const a = 1')
  })

  it('支持 ~~~ 围栏与 ≥3 个反引号', () => {
    const a = parseCodeBlocks('~~~\nx\n~~~')
    const b = parseCodeBlocks('````\nx\n````')
    expect(a).toHaveLength(1)
    expect(b).toHaveLength(1)
  })

  it('反引号围栏不能被 ~~~ 关闭（围栏字符必须一致）', () => {
    const blocks = parseCodeBlocks('```\nx\n~~~\n')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.lineCount).toBe(2) // x 与 ~~~ 都算内容，块未闭合也收下
  })

  it('未闭合的尾块也收下', () => {
    const blocks = parseCodeBlocks('text\n```js\nfoo()')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.lang).toBe('js')
    expect(blocks[0]!.code).toBe('foo()')
  })

  it('尾部空行被剥掉、纯空白块被丢弃', () => {
    const blocks = parseCodeBlocks('```\n\n\n```')
    expect(blocks).toHaveLength(0)
    const b2 = parseCodeBlocks('```\ncode\n\n\n```')
    expect(b2[0]!.code).toBe('code')
  })

  it('行内代码不受影响、多个块各自独立', () => {
    const blocks = parseCodeBlocks('`a` text\n```py\n1\n```\nmid\n```\n2\n```')
    expect(blocks).toHaveLength(2)
    expect(blocks[0]!.lang).toBe('py')
    expect(blocks[1]!.code).toBe('2')
  })

  it('缩进 ≤3 空格的围栏有效、语言后带附加信息只取首词', () => {
    const blocks = parseCodeBlocks('   ```rust ignore\nfn main(){}\n   ```')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.lang).toBe('rust')
  })
})
