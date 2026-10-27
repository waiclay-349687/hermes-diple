// Diple — desktop half. Entry point (W1-owned).
//
// Builds the shared dependencies once, then hands them to the two module
// groups. Each group has exactly one install(ctx, deps) and touches only its
// own folder (internal ownership notes):
//   capture/  — W2a: selection → item, pending list view, locate, highlights
//   send/     — W2b: send flow, response markers, missing answers, settings
//
// deps = { lists, api, batches, settings, i18n, services, ids, session, notify, live, uiBus }
// uiBus: the V2 T ↔ C seam (shared/ui-bus.js), one instance

import { host } from '@hermes/plugin-sdk'

import { createApi } from './shared/api.js'
import { createBatchCatalog } from './shared/batch-catalog.js'
import { createI18n, PLUGIN_ID } from './shared/i18n.js'
import { newBatchId, newItemId } from './shared/ids.js'
import { createListStore } from './shared/list-store.js'
import { createLive } from './shared/live.js'
import { createServices } from './shared/services.js'
import { createSettings } from './shared/settings.js'
import { createUiBus } from './shared/ui-bus.js'
import { installCapture } from './capture/index.js'
import { installSend } from './send/index.js'

/**
 * Other windows' writes to our lists. The host's ctx.storage is localStorage
 * under `hermes.plugin.<id>.` (apps/desktop/src/contrib/plugin.ts) and has no
 * change event of its own; the window `storage` event fires in every other
 * same-origin window. Window focus re-checks all lists as a backstop.
 */
function watchListStorage(ctx) {
  const prefix = `hermes.plugin.${PLUGIN_ID}.list.`
  return (onChange) => {
    if (typeof window === 'undefined') return
    const onStorage = (e) => {
      if (e.key === null) onChange(null) // storage cleared
      else if (typeof e.key === 'string' && e.key.startsWith(prefix)) onChange(e.key.slice(prefix.length))
    }
    const onFocus = () => onChange(null)
    window.addEventListener('storage', onStorage)
    window.addEventListener('focus', onFocus)
    ctx.onDispose?.(() => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('focus', onFocus)
    })
  }
}

export function createDeps(ctx) {
  const settings = createSettings(ctx.storage)
  const api = createApi((path, opts) => ctx.rest(path, opts))
  return {
    lists: createListStore({ storage: ctx.storage, watch: watchListStorage(ctx) }),
    api,
    // the local batch records (shared/batch-catalog.js): send writes, markers / marks / locate read
    batches: createBatchCatalog({ storage: ctx.storage, api }),
    settings,
    i18n: createI18n(ctx, settings),
    services: createServices(),
    ids: { newBatchId, newItemId },
    session: {
      /** Stored id of the session the user last focused: the list key. */
      currentKey: () => host.state.focusedStoredSessionId.get() || null,
      subscribe: (fn) => host.state.focusedStoredSessionId.listen(() => fn())
    },
    notify: (n) => host.notify?.(n),
    // per-session busy state (stored ↔ runtime ids), shared by capture/ and send/
    live: createLive(),
    // V2: capture/ (T) ↔ send/ strip (C), design §3
    uiBus: createUiBus()
  }
}

export default {
  id: PLUGIN_ID,
  name: 'Diple · 圈批', // i18n-allow: the host shows plugin names untranslated
  description: 'Select chat text into a pending list, comment on it, and send it with the full text attached.',
  register(ctx) {
    const deps = createDeps(ctx)
    ctx.onDispose(deps.live.dispose)
    installCapture(ctx, deps)
    installSend(ctx, deps)
    return deps // tests reach the bus and the stores through this; the host ignores it
  }
}
