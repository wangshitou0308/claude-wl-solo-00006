import { useMemo, useState } from 'react'
import type { BillPeriod, RateTier, ReadingKind } from '../types'
import { round2 } from '../lib/calc'
import { uid } from '../lib/utils'

interface Props {
  initial?: BillPeriod
  defaultMeterNo?: string
  defaultStartDate?: string
  defaultEndDate?: string
  onCancel: () => void
  onSave: (data: Omit<BillPeriod, 'id' | 'createdAt' | 'updatedAt' | 'confirmed' | 'recheckRequired'> & { id?: string }) => void
}

type NumStr = string

export function PeriodForm({ initial, defaultMeterNo, defaultStartDate, defaultEndDate, onCancel, onSave }: Props) {
  const [startDate, setStartDate] = useState(initial?.startDate ?? defaultStartDate ?? '')
  const [endDate, setEndDate] = useState(initial?.endDate ?? defaultEndDate ?? '')
  const [meterNo, setMeterNo] = useState(initial?.meterNo ?? defaultMeterNo ?? '')
  const [startReading, setStartReading] = useState<NumStr>(initial ? String(initial.startReading) : '')
  const [endReading, setEndReading] = useState<NumStr>(initial ? String(initial.endReading) : '')
  const [kind, setKind] = useState<ReadingKind>(initial?.kind ?? 'actual')
  const [fixedFee, setFixedFee] = useState<NumStr>(initial ? String(initial.fixedFee) : '12')
  const [billedUsage, setBilledUsage] = useState<NumStr>(initial?.billedUsage === null || initial?.billedUsage === undefined ? '' : String(initial.billedUsage))
  const [billedAmount, setBilledAmount] = useState<NumStr>(initial ? String(initial.billedAmount) : '')
  const [tiers, setTiers] = useState<RateTier[]>(
    initial?.tiers ?? [
      { from: 0, to: 120, price: 3.45 },
      { from: 120, to: 200, price: 4.6 },
      { from: 200, to: null, price: 7.35 },
    ],
  )
  const [note, setNote] = useState(initial?.note ?? '')
  const [disputed, setDisputed] = useState(initial?.disputed ?? false)
  const [error, setError] = useState('')

  const num = (s: NumStr): number => (s === '' || s === null || s === undefined ? NaN : Number(s))

  const preview = useMemo(() => {
    const s = num(startReading)
    const e = num(endReading)
    if (Number.isFinite(s) && Number.isFinite(e)) return round2(e - s)
    return null
  }, [startReading, endReading])

  const setTier = (i: number, patch: Partial<RateTier>) => {
    setTiers((prev) => prev.map((t, idx) => (idx === i ? { ...t, ...patch } : t)))
  }
  const addTier = () => {
    // 在最高档（to=null）之前插入一档：新档从原最高档起点开始
    const capped = tiers.filter((t) => t.to !== null)
    const top = tiers.find((t) => t.to === null)
    const newFrom = capped.length ? (capped[capped.length - 1].to ?? 0) : 0
    const newTo = newFrom + 60
    const next = [...capped, { from: newFrom, to: newTo, price: top?.price ?? 0 }]
    if (top) next.push({ from: newTo, to: null, price: top.price })
    setTiers(next)
  }
  const removeTier = (i: number) => setTiers(tiers.filter((_, idx) => idx !== i))

  const submit = () => {
    setError('')
    if (!startDate || !endDate) return setError('请填写账期起止日期。')
    if (endDate <= startDate) return setError('账期止日要晚于起日。')
    if (!meterNo.trim()) return setError('请填写水表表号（表上钢印号）。')
    const s = num(startReading)
    const e = num(endReading)
    if (!Number.isFinite(s) || !Number.isFinite(e)) return setError('请填写起止读数（数字）。')
    const fee = num(fixedFee)
    const amount = num(billedAmount)
    if (!Number.isFinite(amount)) return setError('请填写纸单上的账单总额。')
    if (tiers.some((t) => !Number.isFinite(t.price) || t.price < 0)) return setError('每一阶梯都要填写不小于 0 的单价。')

    onSave({
      id: initial?.id,
      startDate,
      endDate,
      meterNo: meterNo.trim(),
      startReading: s,
      endReading: e,
      kind,
      tiers: tiers.map((t, i) => ({
        from: i === 0 ? 0 : Number(t.from) || 0,
        to: t.to === null || i === tiers.length - 1 ? null : Number(t.to),
        price: Number(t.price),
      })),
      fixedFee: Number.isFinite(fee) ? fee : 0,
      billedUsage: billedUsage.trim() === '' ? null : Number(billedUsage),
      billedAmount: amount,
      photoId: initial?.photoId ?? null,
      note,
      disputed,
    })
  }

  return (
    <div>
      <div className="form-grid">
        <div className="field">
          <label>账期起始日</label>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div className="field">
          <label>账期截止日</label>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <div className="field full">
          <label>水表表号</label>
          <input type="text" placeholder="例如 LXSY-2025-00782（抄表盖上的钢印号）" value={meterNo} onChange={(e) => setMeterNo(e.target.value)} />
        </div>
        <div className="field">
          <label>起读数（m³）</label>
          <input type="number" step="0.01" inputMode="decimal" value={startReading} onChange={(e) => setStartReading(e.target.value)} />
        </div>
        <div className="field">
          <label>止读数（m³）</label>
          <input type="number" step="0.01" inputMode="decimal" value={endReading} onChange={(e) => setEndReading(e.target.value)} />
        </div>
        <div className="field full">
          <label>本期抄表方式</label>
          <div className="kind-toggle">
            <button type="button" className={kind === 'actual' ? 'on-actual' : ''} onClick={() => setKind('actual')}>
              ✓ 上门实抄
            </button>
            <button type="button" className={kind === 'estimate' ? 'on-estimate' : ''} onClick={() => setKind('estimate')}>
              ~ 估读（无人在家等）
            </button>
          </div>
          {preview !== null && (
            <div className="hint" style={{ marginTop: 6 }}>
              表显用量 = {endReading || '?'} − {startReading || '?'} = <strong>{preview} m³</strong>
              {preview < 0 && <span style={{ color: 'var(--red)' }}>（止读数比起读数小，请检查）</span>}
            </div>
          )}
        </div>
        <div className="field">
          <label>固定费用（元）</label>
          <input type="number" step="0.01" inputMode="decimal" value={fixedFee} onChange={(e) => setFixedFee(e.target.value)} />
          <div className="hint">污水处理费、垃圾费等每期固定收的钱</div>
        </div>
        <div className="field">
          <label>纸单印的用水量（m³，可空）</label>
          <input type="number" step="0.01" inputMode="decimal" value={billedUsage} onChange={(e) => setBilledUsage(e.target.value)} />
          <div className="hint">纸单上没印就留空</div>
        </div>
        <div className="field full">
          <label>账单总额 / 应缴金额（元）</label>
          <input type="number" step="0.01" inputMode="decimal" value={billedAmount} onChange={(e) => setBilledAmount(e.target.value)} />
        </div>

        <div className="field full">
          <label>本期适用阶梯水价</label>
          <div className="hint" style={{ marginBottom: 6 }}>
            按纸单背面或当地水价填写；改价只影响新录入账期，旧账期保留当时费率。
          </div>
          {tiers.map((t, i) => (
            <div className="tier-editor" key={i}>
              <div>
                <div className="t-head">起始水量(m³)</div>
                <input type="number" disabled={i === 0} value={i === 0 ? 0 : t.from} onChange={(e) => setTier(i, { from: Number(e.target.value) })} />
              </div>
              <div>
                <div className="t-head">到(m³，最高档空)</div>
                <input type="number" disabled={i === tiers.length - 1} value={t.to ?? ''} placeholder="不限" onChange={(e) => setTier(i, { to: e.target.value === '' ? null : Number(e.target.value) })} />
              </div>
              <div>
                <div className="t-head">单价(元/m³)</div>
                <input type="number" step="0.01" inputMode="decimal" value={t.price} onChange={(e) => setTier(i, { price: Number(e.target.value) })} />
              </div>
              <button type="button" className="btn-sm btn-danger" disabled={tiers.length <= 1} onClick={() => removeTier(i)}>
                删档
              </button>
            </div>
          ))}
          <button type="button" className="btn-sm" onClick={addTier}>
            + 增加一档
          </button>
        </div>

        <div className="field full">
          <label>备注</label>
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：抄表员上门无人、含楼道公摊等" />
        </div>
        <label className="confirm-item" style={{ borderColor: disputed ? 'var(--red)' : undefined, background: disputed ? 'var(--red-bg)' : undefined }}>
          <input type="checkbox" checked={disputed} onChange={(e) => setDisputed(e.target.checked)} />
          这个账期有争议，加入打印沟通卡
        </label>
      </div>

      {error && (
        <div className="issue error" style={{ marginTop: 14 }}>
          <span className="tag">错</span>
          <span>{error}</span>
        </div>
      )}

      <div className="modal-foot">
        <button className="btn" onClick={onCancel}>
          取消
        </button>
        <button className="btn btn-primary" onClick={submit}>
          保存账期
        </button>
      </div>
    </div>
  )
}

export function newEmptyPeriodId() {
  return uid()
}
