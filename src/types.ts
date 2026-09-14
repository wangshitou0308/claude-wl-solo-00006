// 核心数据类型：账单账期、换表记录、照片凭据

export type ReadingKind = 'actual' | 'estimate' // 实抄 / 估读

export interface RateTier {
  /** 阶梯起始水量（含），单位 m³ */
  from: number
  /** 阶梯结束水量（不含）；null 表示无上限 */
  to: number | null
  /** 单价（元/m³） */
  price: number
}

/** 可逐字段确认的字段键 */
export type ConfirmableField =
  | 'dates'
  | 'meterNo'
  | 'readings'
  | 'kind'
  | 'rate'
  | 'fixedFee'
  | 'billedAmount'
  | 'billedUsage'

/** 字段确认状态：勾过的字段表示“与纸单一致” */
export type ConfirmMap = Partial<Record<ConfirmableField, boolean>>

export const FIELD_LABELS: Record<ConfirmableField, string> = {
  dates: '日期',
  meterNo: '表号',
  readings: '起止读数',
  kind: '实抄/估读',
  rate: '阶梯费率',
  fixedFee: '固定费用',
  billedAmount: '账单总额',
  billedUsage: '账单水量',
}

export interface BillPeriod {
  id: string
  /** 账期起（纸单上的计费起始日），ISO 日期字符串 yyyy-mm-dd */
  startDate: string
  /** 账期止 */
  endDate: string
  /** 水表表号（钢印号） */
  meterNo: string
  /** 起读数 m³ */
  startReading: number
  /** 止读数 m³ */
  endReading: number
  /** 本期是实抄还是估读 */
  kind: ReadingKind
  /** 本期适用的阶梯水价（随账期保存，费率调整后不影响旧账期） */
  tiers: RateTier[]
  /** 固定费用（污水处理费/垃圾费等，元） */
  fixedFee: number
  /** 纸单写明的本期用水量 m³；纸单没印就填 null */
  billedUsage: number | null
  /** 纸单上的应缴总额（元） */
  billedAmount: number
  /** 照片凭据（仅本地 IndexedDB） */
  photoId: string | null
  /** 备注 */
  note: string
  /** 用户标记：该账期有争议、要进打印沟通卡 */
  disputed: boolean
  /** 逐字段确认状态 */
  confirmed: ConfirmMap
  /** 核心字段被修改后置 true，提示旧的勾对结论已失效；重新勾选后清除 */
  recheckRequired: boolean
  /** 录入时间 */
  createdAt: number
  /** 最近一次修改时间 */
  updatedAt: number
}

export interface MeterChange {
  id: string
  /** 换表日期 */
  date: string
  /** 旧表表号 */
  oldMeterNo: string
  /** 旧表拆下时末读数 */
  oldLastReading: number
  /** 新表表号 */
  newMeterNo: string
  /** 新表装上时初读数 */
  newStartReading: number
  note: string
  createdAt: number
}

export interface StoredPhoto {
  id: string
  name: string
  type: string
  dataUrl: string
  createdAt: number
}

/** 费用拆分的一行算式 */
export interface FeeLine {
  /** 例如 “第1阶梯 0–120m³” */
  label: string
  /** 该段水量，可能为负（退减） */
  volume: number
  price: number
  /** 金额，可能为负 */
  amount: number
}

export type IssueLevel = 'error' | 'warn' | 'info'
export type IssueCode =
  | 'date_overlap'
  | 'date_gap'
  | 'meter_chain_break'
  | 'reading_regression'
  | 'reading_gap'
  | 'rate_changed'
  | 'amount_mismatch'
  | 'open_estimate'
  | 'usage_mismatch'
  | 'meterchange_missing'
  | 'meterchange_mismatch'
  | 'no_rate'

export interface Issue {
  code: IssueCode
  level: IssueLevel
  text: string
}

export interface PeriodComputation {
  period: BillPeriod
  /** 时间轴序号（按 endDate 升序，0 起） */
  index: number
  /** 同一块表上的上一账期 id；换表后为 null（改用换表记录接续） */
  prevOnMeterId: string | null
  /** 是否与换表记录接续（本期是新表第一期） */
  linkedToMeterChange: boolean
  /** 若换表时旧表上还有未核对的估读账期，这里给出收口结算结果（挂在新表首期） */
  oldMeterSettlement: {
    oldMeterNo: string
    changeDate: string
    anchor: number
    oldLastReading: number
    estTotal: number
    /** 拆表实读区间总水量 */
    actualTotal: number
    delta: number
    estimateEndDates: string[]
    /** 合计应退（正）/应补（负）金额；无费率算不出时为 null */
    totalRefundAmount: number | null
  } | null
  /**
   * 若本账期是被换表拆表读数核对的估读账期，这里给出该期的收口重算：
   * 按拆表实际水量重算应收，与已收金额对比得出应退/应补。
   */
  changeSettlement: {
    changeDate: string
    oldMeterNo: string
    /** 上一实抄基线 */
    anchor: number
    oldLastReading: number
    /** 收口区间内全部估读账期合计估收水量 */
    estTotal: number
    /** 收口区间实际水量 */
    actualTotal: number
    /** 本账期估收（已收费）水量 */
    chargedVolume: number
    /** 分摊到本账期的实际水量 */
    actualVolume: number
    /** 本账期水量差额（负=估多应退） */
    deltaVolume: number
    /** 按实际水量重算的逐行算式 */
    recomputedFeeLines: FeeLine[]
    /** 按实际水量重算的应缴金额（含固定费） */
    recomputedAmount: number | null
    /** 纸单已收 − 重算应收：正=应退，负=应补 */
    refundAmount: number | null
  } | null
  /** 表具累计用量（起读数是否与上一期止读数/换表末读数衔接） */
  readingStartExpected: number | null
  readingStartDelta: number | null
  /** 账期表显用量 = 止 - 起 */
  grossUsage: number
  /** 沿连续账期推算的“截至上一实抄点已被收费的水量”（本期起算基线，m³累计） */
  chargedBefore: number
  /** 本期新增水量（实抄账期才计算，估读账期为 null） */
  newVolume: number | null
  /** 补收（正）/退减（负）水量，针对估读部分；正常账期为 0 */
  catchUpVolume: number
  /** 计算结论类型 */
  verdict:
    | 'normal' // 正常新增
    | 'estimated_open' // 估读，尚未被后续实抄核对
    | 'estimated_cleared_by_change' // 估读，已被换表拆表读数核对
    | 'estimated_cleared' // 估读，已被后续实抄覆盖
    | 'catchup_extra' // 实抄补收
    | 'catchup_refund' // 实抄退减
    | 'catchup_exact' // 实抄与估读恰好一致
  /** 费用逐行算式 */
  feeLines: FeeLine[]
  variableFee: number
  computedAmount: number
  /** 与纸单总额差额：纸单 - 计算（正=多收，负=少收） */
  amountDelta: number
  /** 纸单水量与表显用量差额 */
  usageDelta: number | null
  issues: Issue[]
}

export interface MeterChangeComputation {
  change: MeterChange
  issues: Issue[]
  /** 旧表待核对估读按拆表读数重算后，合计应退（正）/应补（负）金额；无需结算或无费率时为 null */
  refundTotal: number | null
}

export interface ComputationResult {
  periods: PeriodComputation[]
  meterChanges: MeterChangeComputation[]
  /** 有争议或有 error 级问题的账期（打印沟通卡范围） */
  disputedPeriods: PeriodComputation[]
  totals: {
    errorCount: number
    warnCount: number
    disputedCount: number
  }
}
