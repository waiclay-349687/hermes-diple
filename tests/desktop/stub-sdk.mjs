// @hermes/plugin-sdk stand-in for jsdom tests. Only what the plugins import.
// Test code drives it through globalThis.__sdk (see harness.mjs).
import { useSyncExternalStore } from 'react'

function atom(initial) {
  let value = initial
  const listeners = new Set()
  return {
    get: () => value,
    set(v) {
      value = v
      for (const fn of [...listeners]) fn(v)
    },
    listen(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    subscribe(fn) {
      fn(value)
      listeners.add(fn)
      return () => listeners.delete(fn)
    }
  }
}

const sdk = (globalThis.__sdk ??= {
  submits: [],
  notifications: [],
  submitResult: true,
  locale: atom('zh'),
  state: {
    focusedStoredSessionId: atom('stored-1'),
    busy: atom(false)
  }
})

export const COMPOSER_AREAS = { top: 'composer.top', middleware: 'composer.middleware' }
export const KEYBINDS_AREA = 'keybinds'
export const PALETTE_AREA = 'palette'
export const TRANSCRIPT_DIRECTIVE_AREA = 'transcript.directives'

export const host = {
  state: sdk.state,
  notify: (n) => sdk.notifications.push(n),
  composer: {
    submit: (sessionId, text) => {
      sdk.submits.push({ sessionId, text })
      return typeof sdk.submitResult === 'function' ? sdk.submitResult(sessionId, text) : sdk.submitResult
    },
    // W2a: composer focus requests are recorded in sdk.focusCalls
    focus: (sessionId = null) => {
      ;(sdk.focusCalls ??= []).push(sessionId)
    }
  },
  // W2a: gateway RPC — tests install sdk.request = async (method, params) => …
  request: (method, params) => {
    ;(sdk.requests ??= []).push({ method, params })
    return typeof sdk.request === 'function' ? sdk.request(method, params) : Promise.reject(new Error('no gateway'))
  },
  // W2a: opening a session — tests install sdk.openSession = async (id, opts) => …
  openSession: (id, opts) => {
    ;(sdk.opened ??= []).push({ id, opts })
    return typeof sdk.openSession === 'function' ? sdk.openSession(id, opts) : Promise.resolve()
  },
  listPersistedSessions: () => Promise.resolve({ sessions: sdk.sessions ?? [] })
}

export function usePluginI18n(id) {
  useSyncExternalStore(sdk.locale.listen, sdk.locale.get)
  return (key, ...args) => sdk.i18n.get(id)?.t(key, ...args) ?? key
}

// --- appended by W2b (send/): per-session state, draft API, navigation -------
sdk.state.focusedSessionId ??= atom(null)
sdk.state.busyBySession ??= atom({})
sdk.state.focusedUsage ??= atom(null)
sdk.drafts ??= new Map()
sdk.navigations ??= []
host.composer.getDraft = async (sessionId) => sdk.drafts.get(sessionId ?? '') ?? ''
host.composer.setDraft = async (sessionId, text) => (sdk.drafts.set(sessionId ?? '', text), true)
host.navigate = (path) => sdk.navigations.push(path)
// --- appended by W2c (diple-docs): workspace tabs, sessions, plugin decisions, Markdown ---
sdk.workspaces ??= new Map()
sdk.openedSessions ??= []
sdk.pluginDecisions ??= atom({})
sdk.state.cwd ??= atom('/tmp')
host.openWorkspace = (id, options) => {
  sdk.workspaces.set(id, options)
  return () => sdk.workspaces.delete(id)
}
// W2c records opened ids; keep W2a's `sdk.openSession` hook working too (merged in W3).
const openSessionW2a = host.openSession
host.openSession = async (id, opts) => {
  sdk.openedSessions.push(id)
  return openSessionW2a ? openSessionW2a(id, opts) : undefined
}
host.pluginDecisions = sdk.pluginDecisions

/** A tiny stand-in for the host's Markdown renderer: headings, paragraphs, **bold**, `code`. */
export function MessageTextContent({ text }) {
  const h = createElementForStub
  const inline = (s, key) => {
    const parts = []
    let rest = s
    let i = 0
    for (let m = rest.match(/\*\*([^*]+)\*\*|`([^`]+)`/); m; m = rest.match(/\*\*([^*]+)\*\*|`([^`]+)`/)) {
      if (m.index) parts.push(rest.slice(0, m.index))
      parts.push(m[1] != null ? h('strong', { key: `${key}-${i++}` }, m[1]) : h('code', { key: `${key}-${i++}` }, m[2]))
      rest = rest.slice(m.index + m[0].length)
    }
    if (rest) parts.push(rest)
    return parts
  }
  const blocks = String(text).split(/\n{2,}/).filter((b) => b.trim())
  return h(
    'div',
    { className: 'stub-md' },
    blocks.map((b, k) => {
      const head = b.match(/^(#{1,6}) +(.*)$/)
      if (head) return h(`h${head[1].length}`, { key: k }, inline(head[2], k))
      return h('p', { key: k }, inline(b.replace(/\n/g, ' '), k))
    })
  )
}
import { createElement as createElementForStub } from 'react'
