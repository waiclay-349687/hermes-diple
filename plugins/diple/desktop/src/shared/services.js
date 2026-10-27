// The seam between the two module groups of the Diple desktop half.
// W1-owned: the NAMES and their contracts below are fixed; each group
// provides only its own names (provide() throws otherwise).
//
// capture (W2a) provides:
//   locate(origin) → Promise<'shown' | 'loaded-and-shown' | 'not-loaded' | 'changed' | 'other-session-opened'>
//       scroll to the annotation's original text (used by ann markers)
//   commitEditor() → { ok, key }   V2-X (R8 XV-02): save what the editor beside the
//       text holds into its list and close it; ok false = the list refused (locked):
//       the editor stays open with the draft, and the caller must not send
// send (W2b) provides:
//   ListFooter   React component ({ sessionKey }) rendered at the bottom of the
//                pending list: send button, "send after reply", preview, notices
//   sendNow(sessionKey) → Promise<{ ok, batchId?, reason? }>
//                the single send flow (also used by ⌘Enter and hand-offs)

export const SERVICE_OWNERS = Object.freeze({
  locate: 'capture',
  commitEditor: 'capture',
  ListFooter: 'send',
  sendNow: 'send'
})

export function createServices() {
  const impls = new Map()
  return {
    provide(owner, name, impl) {
      if (SERVICE_OWNERS[name] === undefined) throw new Error(`annotation services: unknown service ${name}`)
      if (SERVICE_OWNERS[name] !== owner) throw new Error(`annotation services: ${name} belongs to ${SERVICE_OWNERS[name]}, not ${owner}`)
      impls.set(name, impl)
      return () => impls.get(name) === impl && impls.delete(name)
    },
    /** The implementation, or undefined when its group is not installed. */
    get(name) {
      return impls.get(name)
    }
  }
}
