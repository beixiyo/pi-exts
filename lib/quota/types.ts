/**
 * 计费/配额查询统一模型（扩展共享）
 *
 * 各厂商计费 API 形态差异大（百分比窗口 / 预充值余额 / 周期花费），
 * 统一收敛为 QuotaSegment 列表：text 为 footer 完整显示文本（英文），
 * pct 供 auto 变色（无百分比的返回 null），resetsAt 为元数据
 */

/** 单个 footer 配额段 */
export interface QuotaSegment {
  /** 完整显示文本，如 "5h 12% used" / "OR $4.20" / "wk reset 4d22h" */
  text: string
  /** 已用百分比（0-100），供 auto 变色；无概念的预充值制返回 null */
  pct: number | null
  /** 重置时刻（epoch 毫秒），无则缺省 */
  resetsAt?: number
}

/** 厂商 adapter：声明凭证来源并产出配额段 */
export interface ProviderAdapter {
  /** auth.json providers 下的键名（按序取第一个有 key 的；命中键会传给 fetchQuota） */
  authKeys: readonly string[]
  /** 环境变量兜底（优先级低于 authKeys） */
  envKey?: string
  /** 拉取该厂商配额段；authKey 为命中的凭证键名（同厂商多键名可对应不同端点）；
   * 失败直接抛错，由聚合层静默吞掉 */
  fetchQuota(key: string, authKey: string, signal: AbortSignal): Promise<QuotaSegment[]>
}
