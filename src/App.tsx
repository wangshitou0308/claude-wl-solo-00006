import { useMemo, useState } from 'react'
import { AppProvider, useApp } from './state/store'
import { PeriodCard } from './components/PeriodCard'
import { MeterChangeBand } from './components/MeterChangeBand'
import { PeriodForm } from './components/PeriodForm'
import { ChangeForm } from './components/ChangeForm'
import { Modal } from './components/Modal'
import { HistoryPanel } from './components/HistoryPanel'
import { PrintCard } from './components/PrintCard'
import { buildSampleData } from './lib/seed'
import type { PeriodComputation } from './types'
import type { MeterChange } from './types'

type Filter = 'all' | 'issue' | 'dispute' | 'estimate'

function Workspace() {
  const app = useApp()
  const [filter, setFilter] = useState<Filter>('all')
  const [periodModal, setPeriodModal] = useState<
    | { mode: 'create' }
    | { mode: 'edit'; comp: PeriodComputation }
    | null
  >(null)
  const [changeModal, setChangeModal] = useState<{ mode: 'create'; anchor?: { date: string; oldMeterNo: string; oldLastReading: number } } | { mode: 'edit'; change: MeterChange } | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [showPrint, setShowPrint] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)

  const { computation } = app

  // 合并时间轴：账期按止日、换表按换表日（与引擎一致），用于在账期带之间插入换表带
  const timeline = useMemo(() => {
    const items: { date: string; order: number; node: React.ReactNode; key: string }[] = []
    for (const c of computation.periods) {
      items.push({
        date: c.period.endDate,
        order: 1,
        key: `p-${c.period.id}`,
        node: <PeriodCard comp={c} onEdit={(comp2) => setPeriodModal({ mode: 'edit', comp: comp2 })} />,
      })
    }
    for (const ch of computation.meterChanges) {
      items.push({
        date: ch.change.date,
        order: 0,
        key: `c-${ch.change.id}`,
        node: (
          <MeterChangeBand
            comp={ch}
            onEdit={() => setChangeModal({ mode: 'edit', change: ch.change })}
            onDelete={() => {
              if (confirm('删除这条换表记录？相关账期将重新按表号断链提示，可在历史中撤销。')) app.removeChange(ch.change.id)
            }}
          />
        ),
      })
    }    return items
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.order - b.order))
      .filter((it) => {
        if (!it.key.startsWith('p-')) return filter === 'all' || filter === 'issue'
        const comp = computation.periods.find((c) => `p-${c.period.id}` === it.key)!
        if (filter === 'issue') return comp.issues.some((i) => i.level === 'error' || i.level === 'warn')
        if (filter === 'dispute') return comp.period.disputed
        if (filter === 'estimate') return comp.period.kind === 'estimate'
        return true
      })
  }, [computation, filter, app])

  if (showPrint) {
    return (
      <>
        <PrintCard onBack={() => setShowPrint(false)} />
      </>
    )
  }

  const lastPeriod = computation.periods.at(-1)

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <h1>水表账单接续核对页</h1>
          <button className="btn btn-primary" onClick={() => setPeriodModal({ mode: 'create' })}>
            ＋ 录入账单
          </button>
          <button
            className="btn"
            onClick={() => {
              const anchor = lastPeriod
                ? { date: lastPeriod.period.endDate, oldMeterNo: lastPeriod.period.meterNo, oldLastReading: lastPeriod.period.endReading }
                : undefined
              setChangeModal({ mode: 'create', anchor })
            }}
          >
            🔧 登记换表
          </button>
          <button className="btn btn-ghost" onClick={() => setShowHistory(true)}>
            历史/撤销
          </button>
          <button className="btn btn-ghost" onClick={() => setShowPrint(true)}>
            🖨 打印沟通卡
          </button>
          <button className="btn btn-ghost" onClick={() => app.setFontSize(app.fontSize === 'normal' ? 'large' : 'normal')}>
            {app.fontSize === 'normal' ? '大字' : '标准字'}
          </button>
          <div className="sub">数据只存在本设备浏览器（IndexedDB），所有计算在本机完成，照片不会上传。</div>
        </div>
      </header>

      {!app.ready ? (
        <div className="empty">正在读取本机记录…</div>
      ) : (
        <>
          <div className="summary">
            <div className="stat">
              <div className="num">{computation.periods.length}</div>
              <div className="lbl">账期数</div>
            </div>
            <div className="stat error">
              <div className="num">{computation.totals.errorCount}</div>
              <div className="lbl">需处理的问题</div>
            </div>
            <div className="stat warn">
              <div className="num">{computation.totals.warnCount}</div>
              <div className="lbl">注意事项</div>
            </div>
            <div className="stat dispute">
              <div className="num">{computation.totals.disputedCount}</div>
              <div className="lbl">争议账期</div>
            </div>
          </div>

          <div className="filters">
            <span style={{ color: 'var(--ink-soft)' }}>只看：</span>
            {([
              ['all', '全部账期'],
              ['issue', '有问题/注意'],
              ['estimate', '估读账期'],
              ['dispute', '争议账期'],
            ] as [Filter, string][]).map(([key, label]) => (
              <button key={key} className={`chip ${filter === key ? 'on' : ''}`} onClick={() => setFilter(key)}>
                {label}
              </button>
            ))}
          </div>

          {computation.periods.length === 0 ? (
            <div className="empty">
              <h3>还没有录入任何账单</h3>
              <p>把纸账单按账期一张张录进来；估读的账单也照实选“估读”。</p>
              <p>换过水表就点“登记换表”，填上旧表末读数和新表初读数。</p>
              <p>
                <button
                  className="btn btn-primary"
                  onClick={() => app.loadSample(buildSampleData)}
                >
                  先装入一份示例数据看看效果
                </button>
              </p>
              <p className="photo-hint">示例包含：正常账期 → 估读预收 → 换表 → 估读后实抄补收。</p>
            </div>
          ) : (
            timeline.map((it) => <div key={it.key}>{it.node}</div>)
          )}

          {app.periods.length > 0 && (
            <div style={{ marginTop: 30, textAlign: 'center' }}>
              <button
                className="btn btn-danger"
                onClick={() => setConfirmClear(true)}
              >
                清空全部本地数据
              </button>
            </div>
          )}
        </>
      )}

      {/* 账期录入/修改弹窗 */}
      {periodModal?.mode === 'create' && (
        <Modal title="录入账单账期" onClose={() => setPeriodModal(null)} wide>
          <PeriodForm
            defaultMeterNo={lastPeriod?.period.meterNo}
            defaultStartDate={lastPeriod?.period.endDate}
            onCancel={() => setPeriodModal(null)}
            onSave={async (data) => {
              await app.savePeriod(data)
              setPeriodModal(null)
            }}
          />
        </Modal>
      )}
      {periodModal?.mode === 'edit' && (
        <Modal title="修改账单账期" onClose={() => setPeriodModal(null)} wide>
          <PeriodForm
            initial={periodModal.comp.period}
            onCancel={() => setPeriodModal(null)}
            onSave={async (data) => {
              await app.savePeriod({ ...data, id: periodModal.comp.period.id })
              setPeriodModal(null)
            }}
          />
        </Modal>
      )}

      {/* 换表弹窗 */}
      {changeModal?.mode === 'create' && (
        <Modal title="登记换表" onClose={() => setChangeModal(null)}>
          <ChangeForm
            defaultDate={changeModal.anchor?.date}
            defaultOldMeterNo={changeModal.anchor?.oldMeterNo}
            defaultOldLastReading={changeModal.anchor?.oldLastReading}
            onCancel={() => setChangeModal(null)}
            onSave={async (data) => {
              await app.saveChange(data)
              setChangeModal(null)
            }}
          />
        </Modal>
      )}
      {changeModal?.mode === 'edit' && (
        <Modal title="修改换表记录" onClose={() => setChangeModal(null)}>
          <ChangeForm
            initial={changeModal.change}
            onCancel={() => setChangeModal(null)}
            onSave={async (data) => {
              await app.saveChange({ ...data, id: changeModal.change.id })
              setChangeModal(null)
            }}
          />
        </Modal>
      )}

      {showHistory && <HistoryPanel onClose={() => setShowHistory(false)} />}

      {confirmClear && (
        <Modal title="确认清空全部数据？" onClose={() => setConfirmClear(false)}>
          <p>将删除本机保存的全部账期、换表记录和照片，且无法找回（历史记录也会失效）。</p>
          <div className="modal-foot">
            <button className="btn" onClick={() => setConfirmClear(false)}>
              取消
            </button>
            <button
              className="btn btn-danger"
              onClick={async () => {
                await app.clearAll()
                setConfirmClear(false)
              }}
            >
              确认全部删除
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

export default function App() {
  return (
    <AppProvider>
      <FontSizeBridge />
      <Workspace />
    </AppProvider>
  )
}

function FontSizeBridge() {
  const app = useApp()
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-fontsize', app.fontSize)
  }
  return null
}
