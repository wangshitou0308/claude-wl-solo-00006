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
console.log('\n全部断言通过 ✅')
