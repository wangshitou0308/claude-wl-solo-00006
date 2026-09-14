import { buildSampleData } from '../src/lib/seed'
import { computeAll, verdictLabel } from '../src/lib/calc'

const { periods, changes } = buildSampleData()
const r = computeAll(periods, changes)

console.log('账期数:', r.periods.length, '换表:', r.meterChanges.length)
console.log('error/warn/disputed:', r.totals)
console.log('---')
for (const c of r.periods) {
  const p = c.period
  console.log(
    `${p.startDate}~${p.endDate} 表${p.meterNo.slice(-5)} ${p.kind === 'actual' ? '实抄' : '估读'} ` +
      `用量=${c.grossUsage} verdict=${verdictLabel(p.kind, c.verdict)} ` +
      `补退=${c.catchUpVolume} 核算=${c.computedAmount.toFixed(2)} 纸单=${p.billedAmount.toFixed(2)} 差额=${c.amountDelta.toFixed(2)}`,
  )
  if (c.oldMeterSettlement) console.log('   旧表收口差额:', c.oldMeterSettlement.delta, 'm³')
  for (const i of c.issues) console.log(`   [${i.level}] ${i.text}`)
}
console.log('--- 换表带 ---')
for (const ch of r.meterChanges) for (const i of ch.issues) console.log(`[${i.level}] ${i.text}`)
console.log('--- 争议/打印范围:', r.disputedPeriods.map((d) => `${d.period.startDate}~${d.period.endDate}`).join(', '))

// 断言关键数值
const find = (s: string, e: string) => r.periods.find((x) => x.period.startDate === s && x.period.endDate === e)!
const p1 = find('2025-01-05', '2025-03-05')
const p5 = find('2025-09-05', '2025-11-05')
const p6 = find('2025-11-05', '2026-01-05')

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error('❌ 断言失败:', msg)
    process.exit(1)
  }
  console.log('✓', msg)
}
assert(p1.verdict === 'normal' && p1.newVolume === 100, '首期实抄：正常 100 m³')
assert(p5.verdict === 'catchup_extra' && p5.catchUpVolume === 6, '估读后实抄：补收 6 m³')
assert(Math.abs(p5.computedAmount - (6 * 3.45 + 12)) < 0.01, '补收金额 = 6×3.45+12 = 32.70 元')
assert(p6.verdict === 'normal' && p6.newVolume === 110, '补收后下期恢复正常 110 m³')
const settle = r.periods.find((x) => x.oldMeterSettlement)?.oldMeterSettlement ?? null
assert(!!settle && settle.delta === -18, '旧表换表收口：估读多收 18 m³ 应退')
assert(!!settle && settle.actualTotal === 92 && settle.estTotal === 110, '收口区间：拆表实际 92 m³，估读 110 m³')
// p3 单期估读分摊：实际 92 m³ → 第一阶梯 92×3.45 + 12 = 329.40；已收 391.50 → 应退 62.10 元
const p3c = r.periods.find((x) => x.period.startDate === '2025-05-05')!
assert(!!p3c.changeSettlement, 'p3 挂有换表收口重算')
assert(p3c.changeSettlement!.actualVolume === 92 && p3c.changeSettlement!.chargedVolume === 110, 'p3 分摊实际 92 m³，已估 110 m³')
assert(Math.abs(p3c.changeSettlement!.recomputedAmount! - 329.4) < 0.01, 'p3 按实际重算应收 329.40 元')
assert(Math.abs(p3c.changeSettlement!.refundAmount! - 62.1) < 0.01, 'p3 应退 62.10 元')
assert(Math.abs(settle!.totalRefundAmount! - 62.1) < 0.01, '收口合计应退 62.10 元')
assert(p3c.amountDelta === 0, 'p3 纸单与原估读账单本身金额吻合（差额 0），退费以收口重算为准')
assert(r.disputedPeriods.some((d) => d.period.startDate === '2025-05-05'), '估多的旧账期进入打印沟通卡')

// 退减场景：估 100 实际只走 80
const t = (id: string, extra: Partial<import('./src/types').BillPeriod> = {}) =>
  ({
    id,
    startDate: '',
    endDate: '',
    meterNo: 'M1',
    startReading: 0,
    endReading: 0,
    kind: 'actual',
    tiers: [{ from: 0, to: null, price: 3 }],
    fixedFee: 0,
    billedUsage: null,
    billedAmount: 0,
    photoId: null,
    note: '',
    disputed: false,
    confirmed: {},
    recheckRequired: false,
    createdAt: 0,
    updatedAt: 0,
    ...extra,
  }) as import('./src/types').BillPeriod
const ref = computeAll(
  [
    t('a', { startDate: '2025-01-01', endDate: '2025-03-01', startReading: 0, endReading: 100, billedAmount: 300 }),
    t('b', { startDate: '2025-03-01', endDate: '2025-05-01', startReading: 100, endReading: 200, kind: 'estimate', billedAmount: 300 }),
    t('c', { startDate: '2025-05-01', endDate: '2025-07-01', startReading: 100, endReading: 180, kind: 'actual', billedAmount: -60 }),
  ],
  [],
)
const rc = ref.periods[2]
assert(rc.verdict === 'catchup_refund' && rc.catchUpVolume === -20, '实抄 180 vs 估 200：退减 20 m³')
assert(Math.abs(rc.computedAmount - (-20 * 3)) < 0.01, '退减金额 = -60 元')

// 两期估读后换表拆表收口：估 60+40=100，实际区间只有 80 → 应退 20 m³，按 6:4 分摊
const t2 = (id: string, extra: Partial<import('../src/types').BillPeriod> = {}) =>
  t(id, {
    startDate: '',
    endDate: '',
    meterNo: 'M2',
    startReading: 0,
    endReading: 0,
    tiers: [{ from: 0, to: null, price: 3 }],
    fixedFee: 0,
    billedAmount: 0,
    ...extra,
  })
const chgId = 'chg2'
const refund2 = computeAll(
  [
    t2('r1', { startDate: '2025-01-01', endDate: '2025-03-01', startReading: 0, endReading: 10, kind: 'actual', billedAmount: 30 }),
    t2('e1', { startDate: '2025-03-01', endDate: '2025-05-01', startReading: 10, endReading: 70, kind: 'estimate', billedAmount: 180 }),
    t2('e2', { startDate: '2025-05-01', endDate: '2025-07-01', startReading: 70, endReading: 110, kind: 'estimate', billedAmount: 120 }),
  ],
  [
    {
      id: chgId,
      date: '2025-07-05',
      oldMeterNo: 'M2',
      oldLastReading: 90,
      newMeterNo: 'M2NEW',
      newStartReading: 0,
      note: '',
      createdAt: 0,
    },
  ],
)
const [, re1, re2] = refund2.periods
assert(re1.changeSettlement?.actualVolume === 48 && re1.changeSettlement?.deltaVolume === -12, '第一期估 60 分摊实际 48，退 12 m³')
assert(re2.changeSettlement?.actualVolume === 32 && re2.changeSettlement?.deltaVolume === -8, '第二期估 40 分摊实际 32，退 8 m³')
assert(Math.abs(re1.changeSettlement?.refundAmount! - 36) < 0.01 && Math.abs(re2.changeSettlement?.refundAmount! - 24) < 0.01, '退水金额 36 元、24 元，合计 60 元')
assert(refund2.meterChanges[0].issues.some((i) => i.level === 'error'), '换表记录给出应退错误级提示')
console.log('\n全部断言通过 ✅')
