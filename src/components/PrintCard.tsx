import { useApp } from '../state/store'

/**
 * 打印沟通卡：只包含争议账期（用户标记争议 或 存在金额/退减等 error），
 * 每条给出账期、表号、纸单数、核算数、差额和完整算式，可直接打印给供水公司窗口。
 */
export function PrintCard({ onBack }: { onBack: () => void }) {
  const app = useApp()
  const items = app.computation.disputedPeriods
  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="print-card">
      <div className="no-print" style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
        <button className="btn" onClick={onBack}>
          ← 返回核对页
        </button>
        <button className="btn btn-primary" onClick={() => window.print()}>
          打印 / 另存为PDF
        </button>
        <span className="photo-hint">打印内容仅下方卡片，共 {items.length} 个争议账期。</span>
      </div>

      <h1>水费账单核对沟通卡</h1>
      <div className="meta">打印日期：{today}</div>

      {items.length === 0 && <p>当前没有争议账期。请先在账期上“标记争议”，或修正存在红色问题的账期。</p>}

      {items.map((c) => {
        const p = c.period
        const lines: string[] = []
        lines.push(`表显用量 = ${p.endReading} − ${p.startReading} = ${c.grossUsage} m³`)
        if (p.kind === 'estimate') {
          if (c.verdict === 'estimated_cleared_by_change') {
            lines.push(`估读账期，已由换表拆表末读数核对（见下）`)
          } else {
            lines.push(`估读账期：按 ${c.grossUsage} m³ 预收费（基线 ${c.chargedBefore}）`)
          }
        } else if (c.verdict !== 'normal') {
          lines.push(`实抄区间 = ${p.endReading} − ${c.chargedBefore} = ${Math.round((p.endReading - c.chargedBefore) * 100) / 100} m³`)
          lines.push(`扣除此前估读已收 ${Math.round((p.endReading - c.chargedBefore - c.catchUpVolume) * 100) / 100} m³`)
          lines.push(`本期${c.catchUpVolume > 0 ? '补收' : '退减'} ${c.catchUpVolume} m³`)
        }
        if (c.oldMeterSettlement) {
          const s = c.oldMeterSettlement
          lines.push(
            `旧表${s.changeDate}拆下收口：基线${s.anchor}→末读${s.oldLastReading}，区间${Math.round((s.oldLastReading - s.anchor) * 100) / 100}m³，估收${s.estTotal}m³，差额${s.delta}m³`,
          )
        }
        if (c.feeLines.length > 0) {
          for (const f of c.feeLines) lines.push(`${f.label}：${f.volume}m³ × ${f.price.toFixed(2)} = ${f.amount.toFixed(2)}元`)
          lines.push(`水量费 ${c.variableFee.toFixed(2)}元 ＋ 固定费 ${p.fixedFee.toFixed(2)}元 = 核算 ${c.computedAmount.toFixed(2)}元`)
        }

        return (
          <div className="print-item" key={p.id}>
            <h3>
              账期 {p.startDate} ～ {p.endDate}｜表号 {p.meterNo}｜{p.kind === 'actual' ? '实抄' : '估读'}
            </h3>
            <div className="row">
              纸单应缴：<strong>{p.billedAmount.toFixed(2)} 元</strong>
              {p.billedUsage !== null && `（纸单水量 ${p.billedUsage} m³）`}
            </div>
            <div className="row">
              按读数与费率核算：<strong>{c.computedAmount.toFixed(2)} 元</strong>
            </div>
            <div className="row">
              金额差额：
              <strong>
                {c.amountDelta > 0 ? '+' : ''}
                {c.amountDelta.toFixed(2)} 元
              </strong>
              （{Math.abs(c.amountDelta) > 0.02 ? (c.amountDelta > 0 ? '纸单多收' : '纸单少收') : '金额吻合'}）
            </div>
            {c.issues
              .filter((i) => i.level === 'error' || i.level === 'warn')
              .map((i, idx) => (
                <div className="row" key={idx} style={{ fontWeight: 600 }}>
                  · {i.text}
                </div>
              ))}
            <div className="formula">
              {lines.map((l, i) => (
                <div key={i}>{l}</div>
              ))}
            </div>
            {p.note && <div className="row">用户备注：{p.note}</div>}
          </div>
        )
      })}

      <div className="print-sign">
        <span>用户签字：________________</span>
        <span>供水公司经办：________________</span>
        <span>日期：____________</span>
      </div>
    </div>
  )
}
