import { useState } from 'react'
import type { MeterChange } from '../types'

interface Props {
  initial?: MeterChange
  defaultOldMeterNo?: string
  defaultOldLastReading?: number
  defaultDate?: string
  onCancel: () => void
  onSave: (data: Omit<MeterChange, 'id' | 'createdAt'> & { id?: string }) => void
}

export function ChangeForm({ initial, defaultOldMeterNo, defaultOldLastReading, defaultDate, onCancel, onSave }: Props) {
  const [date, setDate] = useState(initial?.date ?? defaultDate ?? '')
  const [oldMeterNo, setOldMeterNo] = useState(initial?.oldMeterNo ?? defaultOldMeterNo ?? '')
  const [oldLastReading, setOldLast] = useState<string>(
    initial ? String(initial.oldLastReading) : defaultOldLastReading !== undefined ? String(defaultOldLastReading) : '',
  )
  const [newMeterNo, setNewMeterNo] = useState(initial?.newMeterNo ?? '')
  const [newStartReading, setNewStart] = useState(initial ? String(initial.newStartReading) : '0')
  const [note, setNote] = useState(initial?.note ?? '')
  const [error, setError] = useState('')

  const submit = () => {
    setError('')
    if (!date) return setError('请填写换表日期。')
    if (!oldMeterNo.trim() || !newMeterNo.trim()) return setError('新旧表号都要填写。')
    if (oldMeterNo.trim() === newMeterNo.trim()) return setError('新旧表号相同，请核对表号。')
    const o = Number(oldLastReading)
    const n = Number(newStartReading)
    if (!Number.isFinite(o) || !Number.isFinite(n)) return setError('旧表末读数、新表初读数要填数字。')
    onSave({
      id: initial?.id,
      date,
      oldMeterNo: oldMeterNo.trim(),
      oldLastReading: o,
      newMeterNo: newMeterNo.trim(),
      newStartReading: n,
      note,
    })
  }

  return (
    <div>
      <div className="form-grid">
        <div className="field full">
          <label>换表日期</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <div className="hint">工单/换表凭证上的拆表装表日期</div>
        </div>
        <div className="field">
          <label>旧表表号</label>
          <input type="text" value={oldMeterNo} onChange={(e) => setOldMeterNo(e.target.value)} />
        </div>
        <div className="field">
          <label>旧表拆下末读数（m³）</label>
          <input type="number" step="0.01" inputMode="decimal" value={oldLastReading} onChange={(e) => setOldLast(e.target.value)} />
        </div>
        <div className="field">
          <label>新表表号</label>
          <input type="text" value={newMeterNo} onChange={(e) => setNewMeterNo(e.target.value)} />
        </div>
        <div className="field">
          <label>新表装上初读数（m³）</label>
          <input type="number" step="0.01" inputMode="decimal" value={newStartReading} onChange={(e) => setNewStart(e.target.value)} />
          <div className="hint">新表通常从 0 开始，但务必抄表盖底数</div>
        </div>
        <div className="field full">
          <label>备注</label>
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：六年到期轮换、故障换表" />
        </div>
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
          保存换表记录
        </button>
      </div>
    </div>
  )
}
