// 接续核对计算引擎
// 核心思路：每块表各自维护“上一实抄点”基线（真实表读数）。
// 估读账期按估读水量预收费；下一期实抄时，用本期实抄止读数减去基线，
// 得到这一段总共应用量，再扣除此前连续账期已收费的估读水量，
// 拆出“本期新增 / 补收 / 退减”，避免重复计费。
// 换表时旧表被拆下，拆表末读数就是旧表上待核对估读的“实抄收口点”。

import type {
  BillPeriod,
  ComputationResult,
  FeeLine,
  Issue,
  IssueLevel,
  MeterChange,
  PeriodComputation,
  RateTier,
  ReadingKind,
} from '../types'

/** 金额误差 2 分钱以内视为吻合（四舍五入误差） */
const AMOUNT_TOLERANCE = 0.02
/** 水量误差 0.1 m³ 以内视为吻合 */
const USAGE_TOLERANCE = 0.1

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/** 阶梯计费：按 [from,to) 分段；volume 为负时逐段取反（退减） */
export function calcTieredFees(volume: number, tiers: RateTier[]): { lines: FeeLine[]; total: number } {
  if (tiers.length === 0) return { lines: [], total: 0 }
  const sorted = [...tiers].sort((a, b) => a.from - b.from)
  const sign = volume < 0 ? -1 : 1
  const abs = Math.abs(volume)
  const lines: FeeLine[] = []
  sorted.forEach((tier, i) => {
    const hi = tier.to ?? Infinity
    if (abs <= tier.from) return
    const segVol = Math.min(abs, hi) - tier.from
    if (segVol > 0) {
      lines.push({
        label:
          tier.to === null
            ? `第${i + 1}阶梯 ≥${tier.from}m³ × ${tier.price.toFixed(2)}元`
            : `第${i + 1}阶梯 ${tier.from}–${tier.to}m³ × ${tier.price.toFixed(2)}元`,
        volume: round2(sign * segVol),
        price: tier.price,
        amount: round2(sign * segVol * tier.price),
      })
    }
  })
  const total = round2(lines.reduce((s, l) => s + l.amount, 0))
  return { lines, total }
}

interface MeterState {
  lastPeriod: BillPeriod | null
  /** 最近一期实抄的止读数（收费基线，真实读数） */
  actualAnchor: number | null
  /** 基线之后待核对的估读账期 */
  openEstimates: BillPeriod[]
}

type TimelineEvent =
  | { type: 'period'; period: BillPeriod }
  | { type: 'change'; change: MeterChange }

export function computeAll(periodsIn: BillPeriod[], changesIn: MeterChange[]): ComputationResult {
  const periods = [...periodsIn].sort((a, b) =>
    a.endDate < b.endDate ? -1 : a.endDate > b.endDate ? 1 : a.startDate.localeCompare(b.startDate),
  )
  const changes = [...changesIn].sort((a, b) => a.date.localeCompare(b.date))

  // 统一时间轴：账期按止日、换表按换表日；同日先处理换表
  const timeline: TimelineEvent[] = [
    ...periods.map<TimelineEvent>((p) => ({ type: 'period', period: p })),
    ...changes.map<TimelineEvent>((c) => ({ type: 'change', change: c })),
  ].sort((a, b) => {
    const da = a.type === 'period' ? a.period.endDate : a.change.date
    const db = b.type === 'period' ? b.period.endDate : b.change.date
    if (da !== db) return da < db ? -1 : 1
    // 同日：换表先
    if (a.type !== b.type) return a.type === 'change' ? -1 : 1
    return 0
  })

  const meters = new Map<string, MeterState>()
  const getMeter = (no: string): MeterState => {
    let m = meters.get(no)
    if (!m) {
      m = { lastPeriod: null, actualAnchor: null, openEstimates: [] }
      meters.set(no, m)
    }
    return m
  }

  const changeByNewMeter = new Map<string, MeterChange>()
  for (const c of changes) changeByNewMeter.set(c.newMeterNo, c)
  // 换表时旧表估读的收口结算，按换表记录 id 暂存，随后挂到新表首期
  const pendingSettlements = new Map<string, NonNullable<PeriodComputation['oldMeterSettlement']>>()

  const computations = new Map<string, PeriodComputation>()
  const changeIssues = new Map<string, Issue[]>()
  for (const c of changes) changeIssues.set(c.id, [])

  let errorCount = 0
  let warnCount = 0
  const pushIssue = (list: Issue[], code: Issue['code'], level: IssueLevel, text: string) => {
    list.push({ code, level, text })
    if (level === 'error') errorCount++
    if (level === 'warn') warnCount++
  }

  let prevGlobal: BillPeriod | null = null
  let periodIndex = 0

  for (const ev of timeline) {
    // ============ 换表事件 ============
    if (ev.type === 'change') {
      const ch = ev.change
      const list = changeIssues.get(ch.id)!

      // 旧表末读数与旧表最近账期止读数核对
      const oldMeter = getMeter(ch.oldMeterNo)
      const oldLast = oldMeter.lastPeriod
      if (!oldLast) {
        pushIssue(list, 'meterchange_missing', 'warn', `换表日 ${ch.date} 之前没有旧表「${ch.oldMeterNo}」的账期，末读数 ${ch.oldLastReading} 无账期可核对。`)
      } else if (Math.abs(oldLast.endReading - ch.oldLastReading) > USAGE_TOLERANCE) {
        pushIssue(
          list,
          'meterchange_mismatch',
          'error',
          `旧表「${ch.oldMeterNo}」最近账期止读数（止 ${oldLast.endDate}）是 ${oldLast.endReading}，拆表末读数是 ${ch.oldLastReading}，相差 ${round2(
            ch.oldLastReading - oldLast.endReading,
          )} m³。`,
        )
      }

      // 用拆表末读数给旧表上待核对的估读账期收口（结果挂到后面新表首期展示）
      if (oldMeter.openEstimates.length > 0 && oldMeter.actualAnchor !== null) {
        const estTotal = round2(oldMeter.openEstimates.reduce((s, e) => s + (e.endReading - e.startReading), 0))
        const delta = round2(ch.oldLastReading - oldMeter.actualAnchor - estTotal)
        const estDesc = oldMeter.openEstimates.map((e) => `止${e.endDate}`).join('、')
        if (Math.abs(delta) <= USAGE_TOLERANCE) {
          pushIssue(list, 'open_estimate', 'info', `旧表拆表核对：估读账期（${estDesc}）估收 ${estTotal} m³，与拆表末读数 ${ch.oldLastReading} 一致，不补不退。`)
        } else if (delta < 0) {
          pushIssue(
            list,
            'open_estimate',
            'error',
            `旧表估多应退：估读账期（${estDesc}）共估收 ${estTotal} m³，基线 ${oldMeter.actualAnchor} 至拆表末读数 ${ch.oldLastReading} 实际只有 ${round2(
              ch.oldLastReading - oldMeter.actualAnchor,
            )} m³，应退减 ${Math.abs(delta)} m³。`,
          )
        } else {
          pushIssue(
            list,
            'open_estimate',
            'info',
            `旧表估少补收：估读账期（${estDesc}）共估收 ${estTotal} m³，拆表实际多用 ${delta} m³，应补收。`,
          )
        }
        // 记下结算结果，稍后挂到新表首期
        pendingSettlements.set(ch.id, {
          oldMeterNo: ch.oldMeterNo,
          changeDate: ch.date,
          anchor: oldMeter.actualAnchor,
          oldLastReading: ch.oldLastReading,
          estTotal,
          delta,
          estimateEndDates: oldMeter.openEstimates.map((e) => e.endDate),
        })
        // 旧表上的估读账期此刻已被拆表读数核对，更新其结论与告警
        for (const est of oldMeter.openEstimates) {
          const ec = computations.get(est.id)
          if (ec) {
            ec.verdict = 'estimated_cleared_by_change'
            ec.issues = ec.issues.filter((i) => i.code !== 'open_estimate')
            ec.issues.push({
              code: 'open_estimate',
              level: delta < 0 ? 'error' : 'info',
              text:
                Math.abs(delta) <= USAGE_TOLERANCE
                  ? `换表拆表核对：估读 ${round2(est.endReading - est.startReading)} m³ 与拆表末读数 ${ch.oldLastReading} 吻合，不补不退。`
                  : delta < 0
                    ? `换表拆表核对：本估读账期与其他估读合计估收 ${estTotal} m³，拆表实际区间仅 ${round2(ch.oldLastReading - oldMeter.actualAnchor!)} m³，应退减 ${Math.abs(delta)} m³（详见换表记录）。`
                    : `换表拆表核对：估读合计 ${estTotal} m³，实际区间 ${round2(ch.oldLastReading - oldMeter.actualAnchor!)} m³，应补收 ${delta} m³（详见换表记录）。`,
            })
          }
        }
        oldMeter.openEstimates = []
        oldMeter.actualAnchor = ch.oldLastReading
      }

      // 新表在换表日即以初读数建立基线
      const newMeter = getMeter(ch.newMeterNo)
      newMeter.actualAnchor = ch.newStartReading
      continue
    }

    // ============ 账期事件 ============
    const p = ev.period
    const index = periodIndex++
    const issues: Issue[] = []
    const m = getMeter(p.meterNo)
    const prevOnMeter = m.lastPeriod

    // 1) 日期重叠 / 断档（35 天内的换表空当不提示，双月账期常见）
    if (prevGlobal) {
      if (p.startDate < prevGlobal.endDate) {
        pushIssue(issues, 'date_overlap', 'warn', `日期重叠：本账期起始 ${p.startDate} 早于上一账期止日 ${prevGlobal.endDate}，两期可能重复计费，请核对纸单日期。`)
      } else {
        const gapDays = (new Date(p.startDate).getTime() - new Date(prevGlobal.endDate).getTime()) / 86400000
        if (gapDays > 35) {
          pushIssue(issues, 'date_gap', 'info', `日期断档：${prevGlobal.endDate} 至 ${p.startDate} 之间没有账期记录。`)
        }
      }
    }

    // 2) 表号断链 / 换表接续
    let linkedToMeterChange = false
    let readingStartExpected: number | null = null
    let readingStartDelta: number | null = null
    const changeForNewMeter = changeByNewMeter.get(p.meterNo)
    const isNewMeterFirst = !prevOnMeter && !!changeForNewMeter && p.startDate >= changeForNewMeter.date

    if (prevOnMeter) {
      readingStartExpected = prevOnMeter.endReading
      readingStartDelta = round2(p.startReading - prevOnMeter.endReading)
      if (Math.abs(readingStartDelta) > USAGE_TOLERANCE) {
        if (readingStartDelta < 0) {
          pushIssue(
            issues,
            'reading_regression',
            'error',
            `读数倒退：本期起读数 ${p.startReading} 小于同表上一期（止 ${prevOnMeter.endDate}）止读数 ${prevOnMeter.endReading}，少了 ${Math.abs(
              readingStartDelta,
            )} m³。如非换表，请检查录入数字。`,
          )
        } else {
          pushIssue(
            issues,
            'reading_gap',
            'warn',
            `读数不接续：本期起读数 ${p.startReading} 比上一期（止 ${prevOnMeter.endDate}）止读数 ${prevOnMeter.endReading} 多 ${readingStartDelta} m³，中间可能有未录入账期。`,
          )
        }
      }
    } else if (isNewMeterFirst) {
      linkedToMeterChange = true
      readingStartExpected = changeForNewMeter!.newStartReading
      readingStartDelta = round2(p.startReading - changeForNewMeter!.newStartReading)
      if (Math.abs(readingStartDelta) > USAGE_TOLERANCE) {
        pushIssue(
          issues,
          'meter_chain_break',
          'error',
          `换表接续不符：本期起读数 ${p.startReading} 与换表记录中新表初读数 ${changeForNewMeter!.newStartReading} 相差 ${readingStartDelta} m³。`,
        )
      }
    } else if (!changeForNewMeter) {
      pushIssue(issues, 'meter_chain_break', 'info', `这是表号「${p.meterNo}」的第一期记录，没有更早账期可接续。如表是换装来的，请补录换表信息。`)
    }

    // 3) 表显用量 / 读数倒退
    const grossUsage = round2(p.endReading - p.startReading)
    if (grossUsage < 0) {
      pushIssue(issues, 'reading_regression', 'error', `读数倒退：止读数 ${p.endReading} 小于起读数 ${p.startReading}，表显用量为 ${grossUsage} m³，请核对纸单数字。`)
    }

    // 4) 费率跨期
    if (prevOnMeter) {
      const sig = (t: RateTier[]) => JSON.stringify([...t].sort((a, b) => a.from - b.from).map((x) => [x.from, x.to, x.price]))
      if (prevOnMeter.tiers.length > 0 && sig(prevOnMeter.tiers) !== sig(p.tiers)) {
        pushIssue(issues, 'rate_changed', 'info', `费率跨期：本期阶梯单价与上一期（止 ${prevOnMeter.endDate}）不同。如供水公司在此期间调价属正常，请确认适用日期。`)
      }
    }
    if (p.tiers.length === 0) {
      pushIssue(issues, 'no_rate', 'warn', '本期没有填写阶梯费率，无法核算水费金额，只能核对水量。')
    }

    // 5) 新表首期挂上旧表估读收口结果
    let oldMeterSettlement: PeriodComputation['oldMeterSettlement'] = null
    if (linkedToMeterChange && changeForNewMeter) {
      const s = pendingSettlements.get(changeForNewMeter.id)
      if (s) oldMeterSettlement = s
    }

    // 6) 估读 / 实抄接续核算
    let chargedBefore: number
    let newVolume: number | null = null
    let catchUpVolume = 0
    let verdict: PeriodComputation['verdict']

    if (m.actualAnchor === null) {
      m.actualAnchor = p.startReading
    }
    const priorEstTotal = round2(m.openEstimates.reduce((s, e) => s + (e.endReading - e.startReading), 0))

    if (p.kind === 'estimate') {
      chargedBefore = m.actualAnchor
      verdict = 'estimated_open'
      m.openEstimates.push(p)
      if (linkedToMeterChange) {
        pushIssue(
          issues,
          'open_estimate',
          'warn',
          `本期是新表第一期且为估读，已按估读水量 ${grossUsage} m³ 预收费（基线取换表初读数 ${m.actualAnchor}）。要等后续实抄账单才能确认多收还是少收。`,
        )
      } else {
        pushIssue(
          issues,
          'open_estimate',
          'warn',
          `本期为估读，已按估读水量 ${grossUsage} m³ 预收费。要等后续实抄账单（或换表拆表读数）才能确认多收还是少收。`,
        )
      }
    } else {
      chargedBefore = m.actualAnchor
      const totalSinceAnchor = round2(p.endReading - m.actualAnchor)
      catchUpVolume = round2(totalSinceAnchor - priorEstTotal)

      if (m.openEstimates.length === 0) {
        verdict = 'normal'
        newVolume = grossUsage
        catchUpVolume = 0
      } else if (Math.abs(catchUpVolume) <= USAGE_TOLERANCE) {
        verdict = 'catchup_exact'
        newVolume = 0
        const estDesc = m.openEstimates.map((e) => `止${e.endDate}`).join('、')
        pushIssue(issues, 'open_estimate', 'info', `已核对估读账期（${estDesc}）：估收 ${priorEstTotal} m³，实抄区间共 ${totalSinceAnchor} m³，恰好一致，不补不退。`)
      } else if (catchUpVolume > 0) {
        verdict = 'catchup_extra'
        newVolume = 0
        const estDesc = m.openEstimates.map((e) => `止${e.endDate}`).join('、')
        pushIssue(issues, 'open_estimate', 'info', `已核对估读账期（${estDesc}）：当时估收 ${priorEstTotal} m³，实抄区间共 ${totalSinceAnchor} m³，本期补收 ${catchUpVolume} m³。`)
      } else {
        verdict = 'catchup_refund'
        newVolume = 0
        const estDesc = m.openEstimates.map((e) => `止${e.endDate}`).join('、')
        pushIssue(
          issues,
          'open_estimate',
          'error',
          `已核对估读账期（${estDesc}）：当时估收 ${priorEstTotal} m³，实抄区间共 ${totalSinceAnchor} m³，应退减 ${Math.abs(
            catchUpVolume,
          )} m³。若纸单仍按原估读金额收费，请与供水公司核对。`,
        )
      }
      m.actualAnchor = p.endReading
      m.openEstimates = []
    }

    // 7) 金额核算
    let billableVolume: number
    if (p.kind === 'estimate' || verdict === 'normal') {
      billableVolume = grossUsage
    } else {
      // 补收/退减期：实抄区间总量 − 此前已估收（差额即本期应计水量，可为负）
      billableVolume = round2(p.endReading - chargedBefore - priorEstTotal)
    }
    const { lines: feeLines, total: variableFee } = calcTieredFees(billableVolume, p.tiers)
    const computedAmount = round2(variableFee + p.fixedFee)
    const amountDelta = round2(p.billedAmount - computedAmount)
    if (p.tiers.length > 0 && Math.abs(amountDelta) > AMOUNT_TOLERANCE) {
      pushIssue(
        issues,
        'amount_mismatch',
        'error',
        `金额不符：按本期读数与费率核算应为 ${computedAmount.toFixed(2)} 元，纸单写 ${p.billedAmount.toFixed(2)} 元，${
          amountDelta > 0 ? `纸单多收 ${amountDelta.toFixed(2)}` : `纸单少收 ${Math.abs(amountDelta).toFixed(2)}`
        } 元。`,
      )
    }

    // 8) 纸单水量核对
    let usageDelta: number | null = null
    if (p.billedUsage !== null) {
      usageDelta = round2(p.billedUsage - grossUsage)
      if (Math.abs(usageDelta) > USAGE_TOLERANCE) {
        pushIssue(issues, 'usage_mismatch', 'warn', `水量不符：起止读数差为 ${grossUsage} m³，纸单印的用水量是 ${p.billedUsage} m³，相差 ${Math.abs(usageDelta)} m³。`)
      }
    }

    // 9) 换表后仍有“新表第一期起读数 vs 初读数”问题已在前面处理；
    //    若换表记录缺新表账期，这里补一条（新表从未出现）
    const comp: PeriodComputation = {
      period: p,
      index,
      prevOnMeterId: prevOnMeter?.id ?? null,
      linkedToMeterChange,
      oldMeterSettlement,
      readingStartExpected,
      readingStartDelta,
      grossUsage,
      chargedBefore,
      newVolume,
      catchUpVolume,
      verdict,
      feeLines,
      variableFee,
      computedAmount,
      amountDelta,
      usageDelta,
      issues,
    }
    computations.set(p.id, comp)

    m.lastPeriod = p
    prevGlobal = p
  }

  // 换表记录附带“新表后续账期是否存在”的校验（时间轴走完后判断）
  for (const ch of changes) {
    const list = changeIssues.get(ch.id)!
    const after = periods.find((p) => p.meterNo === ch.newMeterNo && p.startDate >= ch.date)
    if (!after) {
      pushIssue(list, 'meterchange_missing', 'warn', `换表日 ${ch.date} 之后找不到新表「${ch.newMeterNo}」的账期，初读数 ${ch.newStartReading} 尚未使用。`)
    }
  }

  const meterChangeComputations = changes.map((change) => ({ change, issues: changeIssues.get(change.id) ?? [] }))

  const ordered = periods.map((p) => computations.get(p.id)!)
  const disputedPeriods = ordered.filter((c) => c.period.disputed || c.issues.some((i) => i.level === 'error'))

  return {
    periods: ordered,
    meterChanges: meterChangeComputations,
    disputedPeriods,
    totals: {
      errorCount,
      warnCount,
      disputedCount: ordered.filter((c) => c.period.disputed).length,
    },
  }
}

export function verdictLabel(kind: ReadingKind, verdict: PeriodComputation['verdict']): string {
  if (kind === 'estimate') {
    if (verdict === 'estimated_cleared_by_change') return '估读 · 换表拆表已核对'
    return '估读预收（待实抄核对）'
  }
  switch (verdict) {
    case 'normal':
      return '正常新增'
    case 'catchup_extra':
      return '估读后实抄 · 补收'
    case 'catchup_refund':
      return '估读后实抄 · 退减'
    case 'catchup_exact':
      return '估读后实抄 · 不补不退'
    default:
      return ''
  }
}
