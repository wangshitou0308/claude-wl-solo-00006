import { JSDOM } from 'jsdom'
const dom = new JSDOM('<!doctype html><html><body><div id="r"></div></body></html>', { url: 'http://x/', pretendToBeVisual: true })
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
g.EventTarget = dom.window.EventTarget
g.DocumentFragment = dom.window.DocumentFragment
g.ShadowRoot = dom.window.ShadowRoot
g.HTMLInputElement = dom.window.HTMLInputElement
;(g as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

function Probe() {
  const [v, setV] = useState('357')
  return (
    <div>
      <input className="amt" value={v} onChange={(e) => setV(e.target.value)} />
      <button
        onClick={() => {
          ;(document.getElementById('out') as HTMLElement).textContent = `SUBMIT:${v}`
        }}
      >
        保存
      </button>
      <div id="out" />
    </div>
  )
}
const c = document.getElementById('r')!
await act(async () => {
  createRoot(c).render(React.createElement(Probe))
})
const input = c.querySelector('input')!
const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
await act(async () => {
  setter.call(input, '400')
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
})
console.log('input value after input event:', (input as HTMLInputElement).value)
await act(async () => {
  c.querySelector('button')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
console.log('output:', document.getElementById('out')!.textContent)
process.exit(0)
