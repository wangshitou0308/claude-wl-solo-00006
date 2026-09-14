import type { MeterChangeComputation } from '../types'

export function MeterChangeBand({
  comp,
  onEdit,
  onDelete,
}: {
  comp: MeterChangeComputation
  onEdit: () => void
  onDelete: () => void
}) {
  const { change, issues } = comp
  return (
    <div className="change-band">
      <h4>
        {change.date} 换表
        <button className="btn-sm" style={{ marginLeft: 12 }} onClick={onEdit}>
          修改
        </button>
        <button className="btn-sm btn-danger" style={{ marginLeft: 6 }} onClick={onDelete}>
          删除
        </button>
      </h4>
      <div className="change-flow">
        旧表 {change.oldMeterNo}（末读数 {change.oldLastReading}）
        <span className="arrow">➜</span>
        新表 {change.newMeterNo}（初读数 {change.newStartReading}）
      </div>
      {change.note && <div className="photo-hint" style={{ marginTop: 4 }}>备注：{change.note}</div>}
      {issues.length > 0 && (
        <ul className="issues">
          {issues.map((i, idx) => (
            <li className={`issue ${i.level}`} key={idx}>
              <span className="tag">{i.level === 'error' ? '问题' : i.level === 'warn' ? '注意' : '说明'}</span>
              <span>{i.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
