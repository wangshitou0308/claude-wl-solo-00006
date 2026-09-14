// 示例数据：演示“估读预收 → 换表 → 实抄补收/退减”的完整接续
import type { BillPeriod, MeterChange } from '../types'
import { uid } from './utils'

const COMMON_TIERS = [
  { from: 0, to: 120, price: 3.45 },
  { from: 120, to: 200, price: 4.6 },
  { from: 200, to: null, price: 7.35 },
]

const now = Date.now()

function mkPeriod(p: Partial<BillPeriod> & Pick<BillPeriod, 'startDate' | 'endDate' | 'meterNo' | 'startReading' | 'endReading' | 'kind' | 'billedAmount'>): BillPeriod {
  const gross = Math.round((p.endReading! - p.startReading!) * 100) / 100
  return {
    id: uid(),
    tiers: COMMON_TIERS,
    fixedFee: 12,
    billedUsage: gross,
    photoId: null,
    note: '',
    disputed: false,
    confirmed: {},
    recheckRequired: false,
    createdAt: now,
    updatedAt: now,
    ...p,
  }
}

export function buildSampleData(): { periods: BillPeriod[]; changes: MeterChange[] } {
  const oldMeter = 'SM-2018-00431'
  const newMeter = 'LXSY-2025-00782'

  // 账期1：正常实抄 100 m³
  const p1 = mkPeriod({
    startDate: '2025-01-05',
    endDate: '2025-03-05',
    meterNo: oldMeter,
    startReading: 1850,
    endReading: 1950,
    kind: 'actual',
    billedAmount: 357,
    note: '正常双月账期',
  })

  // 账期2：正常实抄 108 m³
  const p2 = mkPeriod({
    startDate: '2025-03-05',
    endDate: '2025-05-05',
    meterNo: oldMeter,
    startReading: 1950,
    endReading: 2058,
    kind: 'actual',
    billedAmount: 384.6,
  })

  // 账期3：没人在家，估读 110 m³ 预收（表实际只走了 92）
  const p3 = mkPeriod({
    startDate: '2025-05-05',
    endDate: '2025-07-05',
    meterNo: oldMeter,
    startReading: 2058,
    endReading: 2168,
    kind: 'estimate',
    billedUsage: 110,
    billedAmount: 391.5,
    note: '抄表员上门无人，按习惯用量估读',
  })

  // 2025-07-10 换表：旧表末读数 2150，新表初读数 0
  const change: MeterChange = {
    id: uid(),
    date: '2025-07-10',
    oldMeterNo: oldMeter,
    oldLastReading: 2150,
    newMeterNo: newMeter,
    newStartReading: 0,
    note: '到期轮换智能表',
    createdAt: now,
  }

  // 账期4：新表第一期，仍是估读 90 m³
  const p4 = mkPeriod({
    startDate: '2025-07-10',
    endDate: '2025-09-05',
    meterNo: newMeter,
    startReading: 0,
    endReading: 90,
    kind: 'estimate',
    billedUsage: 90,
    billedAmount: 322.5,
  })

  // 账期5：实抄 96 m³ → 对估读 90 补收 6 m³（纸单金额演示为只收了新增/或可对照）
  const p5 = mkPeriod({
    startDate: '2025-09-05',
    endDate: '2025-11-05',
    meterNo: newMeter,
    startReading: 90,
    endReading: 96,
    kind: 'actual',
    // 实际区间 0–96 共 96，估读已收 90，补收 6 m³ × 3.45 + 固定费 12
    billedAmount: 32.7,
    billedUsage: 6,
    note: '实抄账单，含对前期估读的补收',
  })

  // 账期6：正常实抄
  const p6 = mkPeriod({
    startDate: '2025-11-05',
    endDate: '2026-01-05',
    meterNo: newMeter,
    startReading: 96,
    endReading: 206,
    kind: 'actual',
    billedUsage: 110,
    billedAmount: 391.5,
  })

  // 旧表 p3 的估读由换表记录“收口”——旧表末读数 2150 与估读止读数 2168 差 18，
  // 这正是需要在沟通卡中讲清楚的争议点，标记争议。
  p3.disputed = true
  p3.note = '旧表估读止读数 2168，但换表拆表末读数只有 2150，疑似估多 18 m³'

  return { periods: [p1, p2, p3, p4, p5, p6], changes: [change] }
}
