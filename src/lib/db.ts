// IndexedDB 持久化：账期、换表、照片、历史快照全部只存在本机浏览器
import { openDB, type IDBPDatabase } from 'idb'
import type { BillPeriod, MeterChange, StoredPhoto } from '../types'

const DB_NAME = 'water-bill-check'
const DB_VERSION = 1

export interface HistoryEntry {
  id: string
  time: number
  action: string
  /** 被改动对象的类型 */
  target: 'period' | 'meterChange'
  targetId: string
  /** 改动前完整快照（撤销用） */
  before: BillPeriod | MeterChange | null
  /** 改动后完整快照 */
  after: BillPeriod | MeterChange | null
}

interface DBShape {
  periods: BillPeriod
  changes: MeterChange
  photos: StoredPhoto
  history: HistoryEntry
}

let dbPromise: Promise<IDBPDatabase<DBShape>> | null = null

function db() {
  if (!dbPromise) {
    dbPromise = openDB<DBShape>(DB_NAME, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains('periods')) {
          database.createObjectStore('periods', { keyPath: 'id' })
        }
        if (!database.objectStoreNames.contains('changes')) {
          database.createObjectStore('changes', { keyPath: 'id' })
        }
        if (!database.objectStoreNames.contains('photos')) {
          database.createObjectStore('photos', { keyPath: 'id' })
        }
        if (!database.objectStoreNames.contains('history')) {
          const store = database.createObjectStore('history', { keyPath: 'id' })
          store.createIndex('by-time', 'time')
        }
      },
    })
  }
  return dbPromise
}

// ---------- 账期 ----------
export async function getAllPeriods(): Promise<BillPeriod[]> {
  return (await db()).getAll('periods')
}
export async function putPeriod(p: BillPeriod): Promise<void> {
  await (await db()).put('periods', p)
}
export async function deletePeriod(id: string): Promise<void> {
  await (await db()).delete('periods', id)
}
export async function bulkPutPeriods(list: BillPeriod[]): Promise<void> {
  const d = await db()
  const tx = d.transaction('periods', 'readwrite')
  await Promise.all(list.map((p) => tx.store.put(p)))
  await tx.done
}

// ---------- 换表 ----------
export async function getAllChanges(): Promise<MeterChange[]> {
  return (await db()).getAll('changes')
}
export async function putChange(c: MeterChange): Promise<void> {
  await (await db()).put('changes', c)
}
export async function deleteChange(id: string): Promise<void> {
  await (await db()).delete('changes', id)
}

// ---------- 照片 ----------
export async function putPhoto(ph: StoredPhoto): Promise<void> {
  await (await db()).put('photos', ph)
}
export async function getPhoto(id: string): Promise<StoredPhoto | undefined> {
  return (await db()).get('photos', id)
}
export async function deletePhoto(id: string): Promise<void> {
  await (await db()).delete('photos', id)
}

// ---------- 历史（撤销） ----------
export async function addHistory(entry: HistoryEntry): Promise<void> {
  const d = await db()
  await d.put('history', entry)
  // 只保留最近 100 条
  const all = await d.getAllFromIndex('history', 'by-time')
  if (all.length > 100) {
    const stale = all.slice(0, all.length - 100)
    const tx = d.transaction('history', 'readwrite')
    await Promise.all(stale.map((h) => tx.store.delete(h.id)))
    await tx.done
  }
}
export async function getRecentHistory(limit = 30): Promise<HistoryEntry[]> {
  const all = await (await db()).getAllFromIndex('history', 'by-time')
  return all.reverse().slice(0, limit)
}
export async function deleteHistory(id: string): Promise<void> {
  await (await db()).delete('history', id)
}
