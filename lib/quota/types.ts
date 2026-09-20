/**
 * 计费/配额查询统一模型（扩展共享）
 *
 * 各厂商计费 API 形态差异大（百分比窗口 / 预充值余额 / 周期花费），
 * 统一收敛为 QuotaSegment 列表：text 为 footer 完整显示文本（英文），
 * pct 供 auto 变色（无百分比的返回 null），resetsAt 为元数据
 */

/** adapter 产出的配额段（provider 归属由聚合层统一标记） */
export interface QuotaSegmentBase {
  /** 完整显示文本，如 "5h 12% used" / "OR $4.20" / "wk reset 4d22h" */
  text: string
  /** 已用百分比（0-100），供 auto 变色；无概念的预充值制返回 null */
  pct: number | null
  /** 重置时刻（epoch 毫秒），无则缺省 */
  resetsAt?: number
}

/** 单个 footer 配额段（聚合层补上 provider 后的最终形态） */
export interface QuotaSegment extends QuotaSegmentBase {
  /** 段归属的 pi provider id（如 'zai'/'openai'），statusline 按当前模型过滤 */
  provider: string
}

/** 凭证解析结果：key 为 API key 或 OAuth access token */
export interface ProviderCredential {
  /** API key 或 OAuth access token（auth.json entry 的 key/access 字段） */
  key: string
  /** 命中的 auth.json providers 键名（同厂商多键名可对应不同端点） */
  authKey: string
  /** OAuth 账号 id（entry.accountId，如 codex 的 ChatGPT-Account-Id 头） */
  accountId?: string
  /** OAuth access token 过期时刻（epoch 毫秒）；API key 无此字段 */
  expiresAt?: number
}

/** 厂商 adapter：声明凭证来源并产出配额段 */
export interface ProviderAdapter {
  /** 该 adapter 服务的 pi provider id 列表（产出段标记为首个，供按当前模型过滤） */
  providers: readonly string[]
  /** auth.json providers 下的键名（按序取第一个有凭证的；命中键会传给 fetchQuota） */
  authKeys: readonly string[]
  /** 环境变量兜底（优先级低于 authKeys） */
  envKey?: string
  /** 拉取该厂商配额段；失败直接抛错，由聚合层静默吞掉 */
  fetchQuota(cred: ProviderCredential, signal: AbortSignal): Promise<QuotaSegmentBase[]>
}
