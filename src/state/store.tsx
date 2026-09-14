// 应用状态：加载 IndexedDB、增删改、逐字段确认、撤销
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { BillPeriod, ConfirmableField, MeterChange, StoredPhoto } from '../types'
import { FIELD_LABELS } from '../types'
import {
  addHistory,
  bulkPutPeriods,
  deleteChange as idbDeleteChange,
  deleteHistory,
  deletePeriod as idbDeletePeriod,
  deletePhoto as idbDeletePhoto,
  getAllChanges,
  getAllPeriods,
  getRecentHistory,
  putChange as idbPutChange,
  putPeriod as idbPutPeriod,
  putPhoto as idbPutPhoto,
  type HistoryEntry,
} from '../lib/db'
import { computeAll } from '../lib/calc'
import { uid } from '../lib/utils'

/** 这些核心字段一改，旧的逐字段确认结论全部失效 */
const CORE_FIELDS: (keyof BillPeriod)[] = [
  'startDate',
  'endDate',
  'meterNo',
  'startReading',
  'endReading',
  'kind',
  'tiers',
  'fixedFee',
  'billedUsage',
  'billedAmount',
]

function coreChanged(a: BillPeriod, b: BillPeriod): boolean {
  return CORE_FIELDS.some((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
}

export type SavePeriodInput = Omit<BillPeriod, 'id' | 'createdAt' | 'updatedAt' | 'confirmed' | 'recheckRequired'> &
  Partial<Pick<BillPeriod, 'id'>>

interface AppState {
  ready: boolean
  periods: BillPeriod[]
  changes: MeterChange[]
  history: HistoryEntry[]
  computation: ReturnType<typeof computeAll>
  fontSize: 'normal' | 'large'
  setFontSize: (s: 'normal' | 'large') => void
  savePeriod: (input: SavePeriodInput) => Promise<void>
  removePeriod: (id: string) => Promise<void>
  saveChange: (data: Omit<MeterChange, 'id' | 'createdAt'> & Partial<Pick<MeterChange, 'id'>>) => Promise<void>
  removeChange: (id: string) => Promise<void>
  toggleConfirm: (id: string, field: ConfirmableField) => Promise<void>
  toggleDispute: (id: string) => Promise<void>
  clearRecheck: (id: string) => Promise<void>
  attachPhoto: (periodId: string, photo: StoredPhoto) => Promise<void>
  removePhoto: (periodId: string) => Promise<void>
  undoEntry: (entry: HistoryEntry) => Promise<boolean>
  loadSample: (factory: () => { periods: BillPeriod[]; changes: MeterChange[] }) => Promise<void>
  clearAll: () => Promise<void>
}

const Ctx = createContext<AppState | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [periods, setPeriods] = useState<BillPeriod[]>([])
  const [changes, setChanges] = useState<MeterChange[]>([])
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [fontSize, setFontSize] = useState<'normal' | 'large'>(() => {
    return (localStorage.getItem('wbc-fontsize') as 'normal' | 'large') || 'normal'
  })

  const refreshHistory = useCallback(async () => {
    setHistory(await getRecentHistory(30))
  }, [])

  useEffect(() => {
    ;(async () => {
      const [ps, cs, hs] = await Promise.all([getAllPeriods(), getAllChanges(), getRecentHistory(30)])
      setPeriods(ps)
      setChanges(cs)
      setHistory(hs)
      setReady(true)
    })()
  }, [])

  useEffect(() => {
    localStorage.setItem('wbc-fontsize', fontSize)
  }, [fontSize])

  const recordHistory = useCallback(
    async (entry: Omit<HistoryEntry, 'id'>) => {
      const full: HistoryEntry = { ...entry, id: uid() }
      await addHistory(full)
      await refreshHistory()
    },
    [refreshHistory],
  )

  const savePeriod = useCallback<AppState['savePeriod']>(
    async (input) => {
      const now = Date.now()
      const existing = input.id ? periods.find((p) => p.id === input.id) : null
      let toSave: BillPeriod
      if (existing) {
        const { id: _id, ...rest } = input
        const next: BillPeriod = { ...existing, ...rest, id: existing.id, updatedAt: now }
        // 核心字段改动 → 旧的逐字段勾对结论全部作废，提示重新核对
        if (coreChanged(existing, next)) {
          next.confirmed = {}
          next.recheckRequired = true
        }
        toSave = next
      } else {
        const { id: _omit, ...rest } = input
        toSave = {
          ...rest,
          id: uid(),
          confirmed: {},
          recheckRequired: false,
          createdAt: now,
          updatedAt: now,
        }
      }
      await idbPutPeriod(toSave)
      await recordHistory({
        time: now,
        action: existing ? '修改账期' : '新增账期',
        target: 'period',
        targetId: toSave.id,
        before: existing ?? null,
        after: toSave,
      })
      setPeriods((prev) => {
        const i = prev.findIndex((p) => p.id === toSave.id)
        if (i < 0) return [...prev, toSave]
        const copy = [...prev]
        copy[i] = toSave
        return copy
      })
    },
    [periods, recordHistory],
  )

  const removePeriod = useCallback(
    async (id: string) => {
      const existing = periods.find((p) => p.id === id)
      await idbDeletePeriod(id)
      // 顺带清掉只属于该账期的本地照片凭据
      if (existing?.photoId) await idbDeletePhoto(existing.photoId)
      if (existing) {
        await recordHistory({
          time: Date.now(),
          action: '删除账期',
          target: 'period',
          targetId: id,
          before: existing,
          after: null,
        })
      }
      setPeriods((prev) => prev.filter((p) => p.id !== id))
    },
    [periods, recordHistory],
  )

  const saveChange = useCallback<AppState['saveChange']>(
    async (input) => {
      const now = Date.now()
      const existing = input.id ? changes.find((c) => c.id === input.id) : null
      const toSave: MeterChange = existing
        ? { ...existing, ...input, id: existing.id }
        : { ...input, id: uid(), createdAt: now }
      await idbPutChange(toSave)
      await recordHistory({
        time: now,
        action: existing ? '修改换表记录' : '登记换表',
        target: 'meterChange',
        targetId: toSave.id,
        before: existing ?? null,
        after: toSave,
      })
      setChanges((prev) => {
        const i = prev.findIndex((c) => c.id === toSave.id)
        if (i < 0) return [...prev, toSave]
        const copy = [...prev]
        copy[i] = toSave
        return copy
      })
    },
    [changes, recordHistory],
  )

  const removeChange = useCallback(
    async (id: string) => {
      const existing = changes.find((c) => c.id === id)
      await idbDeleteChange(id)
      if (existing) {
        await recordHistory({
          time: Date.now(),
          action: '删除换表记录',
          target: 'meterChange',
          targetId: id,
          before: existing,
          after: null,
        })
      }
      setChanges((prev) => prev.filter((c) => c.id !== id))
    },
    [changes, recordHistory],
  )

  const toggleConfirm = useCallback(
    async (id: string, field: ConfirmableField) => {
      const existing = periods.find((p) => p.id === id)
      if (!existing) return
      const next: BillPeriod = {
        ...existing,
        confirmed: { ...existing.confirmed, [field]: !existing.confirmed[field] },
        updatedAt: Date.now(),
      }
      // 任一核心字段重新勾对过，就去掉“需重新核对”提示
      if (next.recheckRequired && Object.values(next.confirmed).some(Boolean)) {
        next.recheckRequired = false
      }
      await idbPutPeriod(next)
      await recordHistory({
        time: Date.now(),
        action: `${next.confirmed[field] ? '勾选' : '取消勾选'}「${FIELD_LABELS[field]}」`,
        target: 'period',
        targetId: id,
        before: existing,
        after: next,
      })
      setPeriods((prev) => prev.map((p) => (p.id === id ? next : p)))
    },
    [periods, recordHistory],
  )

  const toggleDispute = useCallback(
    async (id: string) => {
      const existing = periods.find((p) => p.id === id)
      if (!existing) return
      const next = { ...existing, disputed: !existing.disputed, updatedAt: Date.now() }
      await idbPutPeriod(next)
      setPeriods((prev) => prev.map((p) => (p.id === id ? next : p)))
    },
    [periods],
  )

  const clearRecheck = useCallback(
    async (id: string) => {
      const existing = periods.find((p) => p.id === id)
      if (!existing) return
      const next = { ...existing, recheckRequired: false, updatedAt: Date.now() }
      await idbPutPeriod(next)
      setPeriods((prev) => prev.map((p) => (p.id === id ? next : p)))
    },
    [periods],
  )

  const attachPhoto = useCallback(
    async (periodId: string, photo: StoredPhoto) => {
      const existing = periods.find((p) => p.id === periodId)
      await idbPutPhoto(photo)
      if (existing?.photoId) await idbDeletePhoto(existing.photoId)
      const next = existing ? { ...existing, photoId: photo.id, updatedAt: Date.now() } : null
      if (next) {
        await idbPutPeriod(next)
        setPeriods((prev) => prev.map((p) => (p.id === periodId ? next : p)))
      }
    },
    [periods],
  )

  const removePhoto = useCallback(
    async (periodId: string) => {
      const existing = periods.find((p) => p.id === periodId)
      if (!existing?.photoId) return
      await idbDeletePhoto(existing.photoId)
      const next = { ...existing, photoId: null, updatedAt: Date.now() }
      await idbPutPeriod(next)
      setPeriods((prev) => prev.map((p) => (p.id === periodId ? next : p)))
    },
    [periods],
  )

  const undoEntry = useCallback<AppState['undoEntry']>(
    async (entry) => {
      try {
        if (entry.target === 'period') {
          if (entry.before) {
            await idbPutPeriod(entry.before as BillPeriod)
            setPeriods((prev) => {
              const i = prev.findIndex((p) => p.id === entry.targetId)
              const restored = entry.before as BillPeriod
              return i < 0 ? [...prev, restored] : prev.map((p) => (p.id === entry.targetId ? restored : p))
            })
          } else if (entry.after) {
            // 撤销的是“新增”：把后像删掉
            await idbDeletePeriod(entry.targetId)
            setPeriods((prev) => prev.filter((p) => p.id !== entry.targetId))
          }
        } else {
          if (entry.before) {
            await idbPutChange(entry.before as MeterChange)
            setChanges((prev) => {
              const i = prev.findIndex((c) => c.id === entry.targetId)
              const restored = entry.before as MeterChange
              return i < 0 ? [...prev, restored] : prev.map((c) => (c.id === entry.targetId ? restored : c))
            })
          } else if (entry.after) {
            await idbDeleteChange(entry.targetId)
            setChanges((prev) => prev.filter((c) => c.id !== entry.targetId))
          }
        }
        await deleteHistory(entry.id)
        await refreshHistory()
        return true
      } catch {
        return false
      }
    },
    [refreshHistory],
  )

  const loadSample = useCallback<AppState['loadSample']>(
    async (factory) => {
      const { periods: ps, changes: cs } = factory()
      await bulkPutPeriods(ps)
      for (const c of cs) await idbPutChange(c)
      setPeriods(ps)
      setChanges(cs)
      await refreshHistory()
    },
    [refreshHistory],
  )

  const clearAll = useCallback(async () => {
    for (const p of periods) await idbDeletePeriod(p.id)
    for (const c of changes) await idbDeleteChange(c.id)
    setPeriods([])
    setChanges([])
    await refreshHistory()
  }, [periods, changes, refreshHistory])

  const computation = useMemo(() => computeAll(periods, changes), [periods, changes])

  const value: AppState = {
    ready,
    periods,
    changes,
    history,
    computation,
    fontSize,
    setFontSize,
    savePeriod,
    removePeriod,
    saveChange,
    removeChange,
    toggleConfirm,
    toggleDispute,
    clearRecheck,
    attachPhoto,
    removePhoto,
    undoEntry,
    loadSample,
    clearAll,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp(): AppState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp must be used within AppProvider')
  return v
}
