import { useEffect, useState } from 'react'
import type { PeriodComputation, StoredPhoto } from '../types'
import { FIELD_LABELS, type ConfirmableField } from '../types'
import { verdictLabel } from '../lib/calc'
import { useApp } from '../state/store'
import { fileToCompressedDataUrl, fmtTime, uid } from '../lib/utils'
import { getPhoto } from '../lib/db'

const CONFIRM_ORDER: ConfirmableField[] = ['dates', 'meterNo', 'readings', 'kind', 'rate', 'fixedFee', 'billedUsage', 'billedAmount']

export function PeriodCard({ comp, onEdit }: { comp: PeriodComputation; onEdit: (comp: PeriodComputation) => void }) {
  const { p: period } = { p: comp.period }
  const app = useApp()
  const [zoomPhoto, setZoomPhoto] = useState<StoredPhoto | null>(null)
  const [photo, setPhoto] = useState<StoredPhoto | null>(null)

  // 懒加载照片缩略图
  useEffect(() => {
    if (!period.photoId || photo) return
    let alive = true
    getPhoto(period.photoId).then((ph) => {
      if (alive) setPhoto(ph ?? null)
    })
    return () => {
      alive = false
    }
    // photo 不进依赖：只在 photoId 变化时拉取
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period.photoId])

  const onPickFile = async (file: File) => {
    const r = await fileToCompressedDataUrl(file)
    const ph: StoredPhoto = { id: uid(), name: r.name, type: r.type, dataUrl: r.dataUrl, createdAt: Date.now() }
    await app.attachPhoto(period.id, ph)
    setPhoto(ph)
  }

  const isCatchup = period.kind === 'actual' && comp.verdict !== 'normal'
  const confirmedCount = Object.values(period.confirmed).filter(Boolean).length

  return (
    <div className="period-wrap">
      <div className="card">
        {period.recheckRequired && (
          <div className="recheck-banner">
            <span>⚠ 这个账期被修改过，此前与纸单勾对的结论已失效，请照着纸单重新核对一遍。</span>
            <button className="btn-sm" onClick={() => app.clearRecheck(period.id)}>
              我知道了
            </button>
          </div>
        )}

        <div className="period-head">
          <span className="dates">
            {period.startDate} ～ {period.endDate}
          </span>
          <span className={`badge ${period.kind}`}>{period.kind === 'actual' ? '实抄' : '估读'}</span>
          <span className="badge verdict">{verdictLabel(period.kind, comp.verdict)}</span>
          {period.disputed && <span className="badge disputed">★ 有争议</span>}
          <span className="meter-no">表号：{period.meterNo}</span>
          <div className="period-actions">
            <button className="btn-sm" onClick={() => onEdit(comp)}>
              修改
            </button>
            <button className="btn-sm" onClick={() => app.toggleDispute(period.id)}>
              {period.disputed ? '取消争议' : '标记争议'}
            </button>
            <button className="btn-sm btn-danger" onClick={() => { if (confirm(`删除 ${period.startDate}～${period.endDate} 这个账期？可在历史中撤销。`)) app.removePeriod(period.id) }}>
              删除
            </button>
          </div>
        </div>

        <div className="readings">
          <div className="cell">
            <div className="k">起读数</div>
            <div className="v">{period.startReading}</div>
          </div>
          <div className="cell">
            <div className="k">止读数</div>
            <div className="v">{period.endReading}</div>
          </div>
          <div className="cell">
            <div className="k">表显用量（止−起）</div>
            <div className="v">{comp.grossUsage} m³</div>
          </div>
          {comp.linkedToMeterChange && (
            <div className="cell">
              <div className="k">接续来源</div>
              <div className="v" style={{ fontSize: '1rem' }}>
                换表新表初读数 {comp.readingStartExpected}
              </div>
            </div>
          )}
        </div>

        {/* 逐项算式 */}
        <div className="formula-box">
          <h4>本期算式</h4>
          <div className="formula-line">
            表显用量 = 止读数 {period.endReading} − 起读数 {period.startReading} = <strong>{comp.grossUsage} m³</strong>
          </div>

          {period.kind === 'estimate' && comp.verdict === 'estimated_open' && (
            <div className="formula-line">
              估读预收 {comp.grossUsage} m³（基线 {comp.chargedBefore}），待后续实抄核对
            </div>
          )}
          {period.kind === 'estimate' && comp.verdict === 'estimated_cleared_by_change' && (
            <div className="formula-line">
              本估读账期已由换表拆表末读数核对，结论见下方提示与换表记录。
            </div>
          )}

          {period.kind === 'actual' && comp.verdict === 'normal' && (
            <div className="formula-line">
              前面没有待核对的估读，本期计费水量 = {comp.grossUsage} m³
            </div>
          )}

          {isCatchup && (
            <>
              <div className="formula-line">
                实抄区间总量 = 本期止读数 {period.endReading} − 上一实抄基线 {comp.chargedBefore} ={' '}
                <strong>{Math.round((period.endReading - comp.chargedBefore) * 100) / 100} m³</strong>
              </div>
              <div className="formula-line">
                扣除此前估读账期已收水量{' '}
                {Math.round((period.endReading - comp.chargedBefore - comp.catchUpVolume) * 100) / 100} m³
              </div>
              <div className="formula-line">
                本期{comp.catchUpVolume > 0 ? '补收' : '退减'} ={' '}
                <span className={comp.catchUpVolume > 0 ? 'plus' : 'minus'}>
                  {comp.catchUpVolume > 0 ? '+' : ''}
                  {comp.catchUpVolume} m³
                </span>
              </div>
            </>
          )}

          {comp.oldMeterSettlement && (
            <div className="formula-line" style={{ marginTop: 8 }}>
              旧表「{comp.oldMeterSettlement.oldMeterNo}」于 {comp.oldMeterSettlement.changeDate} 拆下：基线{' '}
              {comp.oldMeterSettlement.anchor} → 拆表末读数 {comp.oldMeterSettlement.oldLastReading}，区间实用{' '}
              {Math.round((comp.oldMeterSettlement.oldLastReading - comp.oldMeterSettlement.anchor) * 100) / 100} m³，
              此前估收 {comp.oldMeterSettlement.estTotal} m³，差额{' '}
              <span className={comp.oldMeterSettlement.delta < 0 ? 'minus' : 'plus'}>
                {comp.oldMeterSettlement.delta > 0 ? '+' : ''}
                {comp.oldMeterSettlement.delta} m³
              </span>
            </div>
          )}

          {comp.feeLines.length > 0 && (
            <>
              <div style={{ marginTop: 8 }}>
                {comp.feeLines.map((l, i) => (
                  <div className="formula-line" key={i}>
                    {l.label}：{l.volume} m³ × {l.price.toFixed(2)} = {l.amount.toFixed(2)} 元
                  </div>
                ))}
              </div>
              <div className="formula-line">
                水量费合计 {comp.variableFee.toFixed(2)} 元 ＋ 固定费用 {period.fixedFee.toFixed(2)} 元 ={' '}
                <strong>{comp.computedAmount.toFixed(2)} 元</strong>
              </div>
            </>
          )}

          <div className="amount-row">
            <div>
              <span className="big" style={{ color: Math.abs(comp.amountDelta) > 0.02 ? 'var(--red)' : 'var(--green)' }}>
                纸单 {period.billedAmount.toFixed(2)} 元
              </span>
            </div>
            <div>
              核算 <span className="big">{comp.computedAmount.toFixed(2)} 元</span>
            </div>
            <div>
              差额{' '}
              <span className="big" style={{ color: Math.abs(comp.amountDelta) > 0.02 ? 'var(--red)' : 'var(--green)' }}>
                {comp.amountDelta > 0 ? '+' : ''}
                {comp.amountDelta.toFixed(2)} 元
              </span>
            </div>
          </div>
        </div>

        {comp.issues.length > 0 && (
          <ul className="issues">
            {comp.issues.map((i, idx) => (
              <li className={`issue ${i.level}`} key={idx}>
                <span className="tag">{i.level === 'error' ? '问题' : i.level === 'warn' ? '注意' : '说明'}</span>
                <span>{i.text}</span>
              </li>
            ))}
          </ul>
        )}

        {/* 照片凭据 */}
        <div className="photo-row">
          {photo && (
            <>
              <img className="photo-thumb" src={photo.dataUrl} alt={photo.name} onClick={() => setZoomPhoto(photo)} />
              <button className="btn-sm btn-danger" onClick={() => { app.removePhoto(period.id); setPhoto(null) }}>
                删除照片
              </button>
            </>
          )}
          <label className="btn-sm" style={{ border: '2px solid var(--line)', borderRadius: 8, padding: '6px 12px', cursor: 'pointer' }}>
            {photo ? '更换纸单照片' : '＋ 拍照/选照片作凭据'}
            <input
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void onPickFile(f)
                e.target.value = ''
              }}
            />
          </label>
          <span className="photo-hint">照片只存在本设备浏览器里，不会上传；换电脑或清理浏览器数据会丢失。</span>
        </div>

        {/* 逐字段确认 */}
        <div className="confirm-row">
          <span style={{ color: 'var(--ink-soft)', fontSize: '0.9rem', alignSelf: 'center' }}>
            照纸单逐项核对（已勾 {confirmedCount}/{CONFIRM_ORDER.length}）：
          </span>
          {CONFIRM_ORDER.map((f) => (
            <label key={f} className={`confirm-item ${period.confirmed[f] ? 'checked' : ''}`}>
              <input type="checkbox" checked={!!period.confirmed[f]} onChange={() => app.toggleConfirm(period.id, f)} />
              {FIELD_LABELS[f]}
            </label>
          ))}
        </div>

        {period.note && (
          <div className="photo-hint" style={{ marginTop: 8 }}>
            备注：{period.note}
          </div>
        )}
        <div className="photo-hint" style={{ marginTop: 4 }}>
          录入于 {fmtTime(period.createdAt)}
          {period.updatedAt > period.createdAt ? `，最近修改 ${fmtTime(period.updatedAt)}` : ''}
        </div>
      </div>

      <div className="period-rail" />

      {zoomPhoto && (
        <div className="lightbox" onClick={() => setZoomPhoto(null)}>
          <img src={zoomPhoto.dataUrl} alt={zoomPhoto.name} />
        </div>
      )}
    </div>
  )
}
