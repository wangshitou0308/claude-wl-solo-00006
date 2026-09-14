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
        const s = c.changeSettlement
        const lines: string[] = []
        lines.push(`【原账单（估读）】`)
        lines.push(`表显（估读）用量 = 止读数 ${p.endReading} − 起读数 ${p.startReading} = ${c.grossUsage} m³`)
        for (const f of c.feeLines) lines.push(`${f.label}：${f.volume}m³ × ${f.price.toFixed(2)} = ${f.amount.toFixed(2)}元`)
        lines.push(`水量费 ${c.variableFee.toFixed(2)}元 ＋ 固定费用 ${p.fixedFee.toFixed(2)}元 = 已收 ${p.billedAmount.toFixed(2)}元`)

        if (s) {
          lines.push('')
          lines.push(`【换表拆表核实 · 重算】`)
          lines.push(`① 拆表实读区间 = 拆表末读数 ${s.oldLastReading} − 上一实抄基线 ${s.anchor} = ${s.actualTotal} m³`)
          lines.push(
            `② 本账期分摊实际水量 = 实读区间 ${s.actualTotal} ×（本账期估读 ${s.chargedVolume} ÷ 估读合计 ${s.estTotal}）= ${s.actualVolume} m³`,
          )
          lines.push(
            `③ 水量差额 = 分摊实际 ${s.actualVolume} − 已估收 ${s.chargedVolume} = ${s.deltaVolume} m³（${s.deltaVolume < 0 ? '估多，应退水' : '估少，应补水'}）`,
          )
          for (const f of s.recomputedFeeLines)
            lines.push(`④ ${f.label}：${f.volume}m³ × ${f.price.toFixed(2)} = ${f.amount.toFixed(2)}元`)
          if (s.recomputedAmount !== null && s.refundAmount !== null) {
            const recomputedVariable = s.recomputedFeeLines.reduce((sum, l) => sum + l.amount, 0)
            lines.push(`⑤ 重算应缴 = 重算水量费 ${recomputedVariable.toFixed(2)}元 ＋ 固定费用 ${p.fixedFee.toFixed(2)}元 = ${s.recomputedAmount.toFixed(2)}元`)
            lines.push(
              `⑥ ${s.refundAmount >= 0 ? '应退金额' : '应补金额'} = 已收 ${p.billedAmount.toFixed(2)} − 重算应缴 ${s.recomputedAmount.toFixed(2)} = ${Math.abs(s.refundAmount).toFixed(2)}元`,
            )
            lines.push(`   （固定费用属实际发生服务，两期都计、不退；若贵司另有规定请注明。）`)
          }
        } else if (p.kind === 'estimate') {
          lines.push(`本账期为估读预收，尚未经实抄或换表核对。`)
        } else if (c.verdict !== 'normal') {
          lines.push('')
          lines.push(`【估读后实抄核对】`)
          lines.push(`实抄区间 = ${p.endReading} − ${c.chargedBefore} = ${Math.round((p.endReading - c.chargedBefore) * 100) / 100} m³`)
          lines.push(`扣除此前估读已收 ${Math.round((p.endReading - c.chargedBefore - c.catchUpVolume) * 100) / 100} m³`)
          lines.push(`本期${c.catchUpVolume > 0 ? '补收' : '退减'} ${c.catchUpVolume} m³`)
        }
        if (c.oldMeterSettlement && !s) {
          const os = c.oldMeterSettlement
          lines.push('')
          lines.push(
            `旧表${os.changeDate}拆下收口：基线${os.anchor}→末读${os.oldLastReading}，实读区间${os.actualTotal}m³，估收${os.estTotal}m³，水量差${os.delta}m³` +
              (os.totalRefundAmount !== null
                ? `；按各估读账期费率重算合计${os.totalRefundAmount >= 0 ? '应退' : '应补'} ${Math.abs(os.totalRefundAmount).toFixed(2)}元（明细在旧表各估读账期）`
                : ''),
          )
        }

        return (
          <div className="print-item" key={p.id}>
            <h3>
              账期 {p.startDate} ～ {p.endDate}｜表号 {p.meterNo}｜{p.kind === 'actual' ? '实抄' : '估读'}
              {s && '｜换表拆表已重算'}
            </h3>
            <div className="row">
              纸单已收：<strong>{p.billedAmount.toFixed(2)} 元</strong>
              {p.billedUsage !== null && `（纸单水量 ${p.billedUsage} m³）`}
            </div>
            {s ? (
              <>
                <div className="row">
                  按拆表实际水量重算应缴：<strong>{s.recomputedAmount?.toFixed(2) ?? '—'} 元</strong>
                </div>
                <div className="row">
                  应退水量：<strong>{Math.abs(s.deltaVolume)} m³</strong>（实读分摊 {s.actualVolume} − 已估 {s.chargedVolume}）
                </div>
                <div className="row" style={{ fontSize: '1.08rem' }}>
                  {s.refundAmount !== null && (
                    <>
                      {s.refundAmount >= 0 ? (
                        <span style={{ color: '#000' }}>
                          应退金额：<strong>{s.refundAmount.toFixed(2)} 元</strong>
                        </span>
                      ) : (
                        <span style={{ color: '#000' }}>
                          应补金额：<strong>{Math.abs(s.refundAmount).toFixed(2)} 元</strong>
                        </span>
                      )}
                      <span> = 已收 {p.billedAmount.toFixed(2)} − 重算 {s.recomputedAmount!.toFixed(2)}</span>
                    </>
                  )}
                </div>
                <div className="row photo-hint">说明：原账单按估读读数收费本身无误，差额来自换表拆表实际读数小于估读读数。</div>
              </>
            ) : (
              <>
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
              </>
            )}
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
