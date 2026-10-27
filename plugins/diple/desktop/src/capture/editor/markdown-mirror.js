// Markdown for the plain-DOM overlays (editor summary, hover preview), drawn
// by the host's own renderer (design §2.8): SDK MessageTextContent, else
// Streamdown, else plain text.
//
// The overlays live on <body> (above the transcript, outside any host
// stacking context or fade), and the plugin cannot mount React there (no
// react-dom in the SDK). So a hidden "mirror" component, contributed to the
// composer.top slot, renders the requested texts with the host renderer, and
// each request's target receives a static copy of the result, refreshed while
// the renderer is still filling in (lazy highlighting).
//
//   const md = createMarkdownMirror({ doc })
//   md.Mirror                       React component for the composer.top slot
//   md.render(target, text) → off   target shows `text` as Markdown (plain text until rendered)
//   md.dispose()

import * as SDK from '@hermes/plugin-sdk'
import { createElement, useEffect, useRef, useSyncExternalStore } from 'react'

export function createMarkdownMirror({ doc = globalThis.document } = {}) {
  const requests = new Map() // id → { text, target }
  const listeners = new Set()
  let version = 0
  let nextId = 0
  const bump = () => {
    version++
    for (const fn of [...listeners]) fn()
  }
  const subscribe = (fn) => {
    listeners.add(fn)
    return () => listeners.delete(fn)
  }

  const Renderer = SDK.MessageTextContent ?? null
  const Fallback = SDK.Streamdown ?? null

  function copy(id, source) {
    const req = requests.get(id)
    if (!req || !source) return
    const text = source.textContent ?? ''
    if (!text.trim()) return // not rendered yet: keep the plain text
    const clone = source.cloneNode(true)
    clone.removeAttribute('data-diple-md-source')
    clone.removeAttribute('hidden')
    clone.className = 'diple-md'
    // static copy: nothing in it is focusable or clickable. A link the
    // renderer drew as a button keeps its words as plain text (R8 XV-06);
    // other buttons (copy, expand) are chrome and go.
    for (const el of clone.querySelectorAll('button, [tabindex], a')) {
      if (el.tagName !== 'BUTTON') el.setAttribute('tabindex', '-1')
      else if (el.getAttribute('data-streamdown') === 'link') {
        const span = doc.createElement('span')
        span.className = 'diple-md-link'
        span.textContent = el.textContent ?? ''
        el.replaceWith(span)
      } else el.remove()
    }
    req.target.replaceChildren(clone)
  }

  function Source({ id, text }) {
    const ref = useRef(null)
    useEffect(() => {
      const el = ref.current
      if (!el) return undefined
      copy(id, el)
      const MO = doc.defaultView?.MutationObserver
      if (!MO) return undefined
      const mo = new MO(() => copy(id, el))
      mo.observe(el, { subtree: true, childList: true, characterData: true, attributes: true })
      return () => mo.disconnect()
    }, [id, text])
    const body = Renderer ? createElement(Renderer, { text, media: false }) : Fallback ? createElement(Fallback, null, text) : text
    return createElement('div', { ref, 'data-diple-md-source': id }, body)
  }

  // One mounted mirror is enough; split view mounts the slot once per composer.
  let owner = null
  function Mirror() {
    const me = useRef({})
    if (!owner) owner = me.current
    useEffect(
      () => () => {
        if (owner === me.current) {
          owner = null
          bump()
        }
      },
      []
    )
    useSyncExternalStore(subscribe, () => version)
    if (owner !== me.current) return null
    return createElement(
      'div',
      { hidden: true, 'aria-hidden': 'true', 'data-diple-md-mirror': '' },
      [...requests.entries()].map(([id, r]) => createElement(Source, { key: id, id, text: r.text }))
    )
  }

  return {
    Mirror,
    render(target, text) {
      const id = `m${++nextId}`
      const plain = doc.createElement('div')
      plain.className = 'diple-md diple-md-plain'
      plain.textContent = text
      target.replaceChildren(plain)
      requests.set(id, { text, target })
      bump()
      return () => {
        if (requests.delete(id)) bump()
      }
    },
    dispose() {
      requests.clear()
      bump()
    }
  }
}
