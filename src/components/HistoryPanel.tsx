import { useState } from 'react'
import { Modal } from './Modal'
import { useApp } from '../state/store'
import { fmtTime } from '../lib/utils'
import type { HistoryEntry } from '../lib/db'

/** 单条历史可展开查看原始录入（before / after 完整快照） */
function HistoryDetail({ entry }: { entry: HistoryEntry }) {
  const [show, setShow] = useState(false)
  return (
    <div style={{ width: '100%' }}>
      <button className="btn-link" onClick={() => setShow(!show)}>
        {show ? '收起原始录入' : '查看原始录入'}
      </button>
      {show && (
        <div className="formula-box" style={{ marginTop: 6 }}>
          {entry.before && (
            <pre className="formula-line" style={{ whiteSpace: 'pre-wrap' }}>
              {'修改前：\n' + JSON.stringify(entry.before, null, 2)}
            </pre>
          )}
          {entry.after && (
            <pre className="formula-line" style={{ whiteSpace: 'pre-wrap' }}>
              {entry.before ? '修改后：\n' : '原始录入：\n'}
              {JSON.stringify(entry.after, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

export function HistoryPanel({ onClose }: { onClose: () => void }) {
  const app = useApp()
  const [busy, setBusy] = useState<string | null>(null)

  return (
    <Modal title="操作记录与撤销（最近 30 条）" onClose={onClose}>
      {app.history.length === 0 && <p>还没有操作记录。</p>}
      <ul className="history-list">
        {app.history.map((h) => (
          <li className="history-item" key={h.id}>
            <span className="t">{fmtTime(h.time)}</span>
            <strong>{h.action}</strong>
            <span className="photo-hint">{h.target === 'period' ? '账期' : '换表'}</span>
            <button
              className="btn-sm btn-primary"
              disabled={busy === h.id}
              onClick={async () => {
                setBusy(h.id)
                const ok = await app.undoEntry(h)
                setBusy(null)
                if (!ok) alert('撤销失败，原始数据可能已不存在。')
              }}
            >
              {busy === h.id ? '撤销中…' : '↩ 撤销这一步'}
            </button>
            <HistoryDetail entry={h} />
          </li>
        ))}
      </ul>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>
          关闭
        </button>
      </div>
    </Modal>
  )
}
