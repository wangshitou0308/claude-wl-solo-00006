// 端到端冒烟：jsdom + fake-indexeddb 渲染整个应用，装入示例数据并核对页面结论
import { JSDOM } from 'jsdom'
import fakeIndexedDB, {
  IDBKeyRange,
  IDBRequest,
  IDBOpenDBRequest,
  IDBDatabase,
  IDBTransaction,
  IDBObjectStore,
  IDBIndex,
  IDBCursor,
  IDBVersionChangeEvent,
} from 'fake-indexeddb'

const dom = new JSDOM('<!doctype html><html lang="zh-CN"><body><div id="root"></div></body></html>', {
  url: 'http://127.0.0.1:5173/',
  pretendToBeVisual: true,
})

// 在 require React 之前布置全局环境
const g = globalThis as Record<string, unknown>
g.window = dom.window
g.document = dom.window.document
g.navigator = dom.window.navigator
g.HTMLElement = dom.window.HTMLElement
g.Element = dom.window.Element
g.Node = dom.window.Node
g.Event = dom.window.Event
g.MouseEvent = dom.window.MouseEvent
g.getComputedStyle = dom.window.getComputedStyle
g.indexedDB = fakeIndexedDB
g.IDBKeyRange = IDBKeyRange
g.IDBRequest = IDBRequest
g.IDBOpenDBRequest = IDBOpenDBRequest
g.IDBDatabase = IDBDatabase
g.IDBTransaction = IDBTransaction
g.IDBObjectStore = IDBObjectStore
g.IDBIndex = IDBIndex
g.IDBCursor = IDBCursor
g.IDBVersionChangeEvent = IDBVersionChangeEvent
g.localStorage = dom.window.localStorage
;(g as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
// jsdom 没有 matchMedia / scrollTo
;(dom.window as unknown as Record<string, unknown>).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
g.scrollTo = () => {}
process.on('unhandledRejection', (e) => console.log('UNHANDLED:', e))

import ReactPkg from 'react'
const React = ReactPkg
// 注意：打包到 Node 跑 jsdom 时，react-dom 必须用动态导入，
// 静态导入会导致受控组件的事件不被接收（CJS/ESM 互操作时序问题）
const { createRoot } = await import('react-dom/client')
const { act } = await import('react-dom/test-utils')
import { buildSampleData } from '../src/lib/seed'
import { computeAll } from '../src/lib/calc'

// 直接测引擎（已在另一脚本断言），这里重点验证 React 树能渲染出关键文案
async function flush(ms = 20) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms))
  })
}

const container = document.getElementById('root')!
const { default: App } = await import('../src/App')

await act(async () => {
  createRoot(container).render(React.createElement(App))
})
await flush()

const html1 = container.textContent ?? ''
function expectText(txt: string, present: boolean, label: string) {
  const has = html1.includes(txt)
  if (has !== present) {
    console.error(`❌ ${label}: 期望${present ? '存在' : '不存在'}「${txt}」，实际${has ? '存在' : '不存在'}`)
    process.exit(1)
  }
  console.log(`✓ ${label}：「${txt}」`)
}

expectText('水表账单接续核对页', true, '标题渲染')
expectText('还没有录入任何账单', true, '空状态')
expectText('先装入一份示例数据看看效果', true, '示例数据按钮')

// 点“装入示例数据”
const buttons = Array.from(container.querySelectorAll('button'))
const seedBtn = buttons.find((b) => b.textContent?.includes('示例数据'))!
await act(async () => {
  seedBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
await flush(50)

const html2 = container.textContent ?? ''
const checks = [
  '估读预收（待实抄核对）',
  '估读 · 换表拆表已核对',
  '估读后实抄 · 补收',
  '本期补收 6 m³',
  '正常新增',
  '应退减 18 m³',
  '本账期分摊实际',
  '重算应缴',
  '62.10 元',
  'SM-2018-00431',
  'LXSY-2025-00782',
  '换表',
  '纸单',
  '核算',
  '差额',
  '照纸单逐项核对',
  '有争议',
]
for (const t of checks) {
  if (!html2.includes(t)) {
    console.error('❌ 示例装入后缺少文案：', t)
    process.exit(1)
  }
  console.log('✓ 页面含：', t)
}

// 问题计数：红色“问题”字样至少若干处
const issueCount = (html2.match(/问题/g) ?? []).length
console.log('页面“问题”字样数（含汇总与标签）：', issueCount)
if (issueCount < 2) {
  console.error('❌ 问题标签数量异常')
  process.exit(1)
}

// 打开打印沟通卡
const printBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('打印沟通卡'))!
await act(async () => {
  printBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
await flush(30)
const html3 = container.textContent ?? ''
if (!html3.includes('水费账单核对沟通卡')) {
  console.error('❌ 打印卡未渲染')
  process.exit(1)
}
// 打印卡上应含完整重算算式与应退金额，而不是金额差额 0.00
for (const t of ['拆表实读区间', '本账期分摊实际', '重算应缴', '应退金额', '62.10 元']) {
  if (!html3.includes(t)) {
    console.error('❌ 打印卡缺少退费算式：', t)
    process.exit(1)
  }
}
if (html3.includes('金额差额：') && html3.match(/2025-05-05[\s\S]{0,1200}金额差额：0\.00/)) {
  console.error('❌ 退费账期仍显示金额差额 0.00')
  process.exit(1)
}
console.log('✓ 打印沟通卡含换表退费完整算式与应退金额')

// 打开历史面板
const backBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('返回核对页'))!
await act(async () => {
  backBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
await flush(20)
const histBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('历史/撤销'))!
await act(async () => {
  histBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
await flush(20)
const html4 = container.textContent ?? ''
if (!html4.includes('操作记录与撤销')) {
  console.error('❌ 历史面板未渲染')
  process.exit(1)
}
console.log('✓ 历史/撤销面板渲染')
await act(async () => {
  Array.from(container.querySelectorAll('button')).find((b) => b.textContent === '关闭')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
await flush()

// 先在第一个账期勾选“账单总额”
const firstCheck = Array.from(container.querySelectorAll('input[type=checkbox]')).find((el) => {
  const lbl = (el.closest('.confirm-item') as HTMLElement)?.textContent
  return lbl?.includes('账单总额')
})!
await act(async () => {
  firstCheck.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
await flush()
if (!container.textContent?.includes('已勾 1/8')) {
  console.error('❌ 勾选后计数未更新')
  process.exit(1)
}
console.log('✓ 逐字段勾选生效（1/8）')

// 打开第一个“修改”，把账单总额从 357 改成 400
await act(async () => {
  Array.from(container.querySelectorAll('button')).find((b) => b.textContent === '修改')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
await flush()
const modal = container.querySelector('.modal')!
const amountField = Array.from(modal.querySelectorAll('.field')).find((f) => f.textContent?.includes('账单总额 / 应缴金额'))!
const amountInput = amountField.querySelector('input')! as HTMLInputElement
const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
await act(async () => {
  setter.call(amountInput, '400')
  amountInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
})
await act(async () => {
  Array.from(modal.querySelectorAll('button')).find((b) => b.textContent === '保存账期')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
await flush(30)

if (!container.textContent?.includes('结论已失效')) {
  console.error('❌ 修改核心字段后未出现“结论已失效”横幅')
  process.exit(1)
}
console.log('✓ 修改核心金额后旧结论立即失效')
if (container.textContent?.includes('已勾 1/8')) {
  console.error('❌ 旧勾选未清空')
  process.exit(1)
}
console.log('✓ 旧的逐字段勾选已清空')
if (!container.textContent?.includes('400.00')) {
  console.error('❌ 新金额未显示')
  process.exit(1)
}
if (!container.textContent?.includes('纸单多收 43.00')) {
  console.error('❌ 金额不符提示未出现')
  process.exit(1)
}
console.log('✓ 新金额 400.00 已生效并出现金额不符提示')

// 撤销这一步修改
await act(async () => {
  Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('历史/撤销'))!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
await flush()
const undoBtn = Array.from(container.querySelectorAll('.modal button')).find((b) => b.textContent?.includes('撤销这一步'))!
await act(async () => {
  undoBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
await flush(30)
const restored = container.textContent
if (restored?.includes('结论已失效')) {
  console.error('❌ 撤销后失效横幅仍在')
  process.exit(1)
}
if (!restored?.includes('已勾 1/8')) {
  console.error('❌ 撤销后勾选状态未恢复')
  process.exit(1)
}
console.log('✓ 撤销误改：金额与勾选状态全部恢复')

console.log('\nReact 渲染冒烟全部通过 ✅')

// 引擎再保险一次（示例数据补退关键结论）
const { periods, changes } = buildSampleData()
const r = computeAll(periods, changes)
const byRange = (a: string, b: string) => r.periods.find((p) => p.period.startDate === a && p.period.endDate === b)!
if (byRange('2025-09-05', '2025-11-05').catchUpVolume !== 6) throw new Error('补收断言失败')
console.log('引擎断言复核通过 ✅')
process.exit(0)
