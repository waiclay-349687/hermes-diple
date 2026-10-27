// Shared core of the Diple plugins: pure logic, no DOM, no host, no storage.
// Bundled separately into each plugin at build time (ADR 0004).
import * as protocol from './handoff-protocol.js'

export * as PendingList from './pending-list.js'
export * as Envelope from './envelope.js'
export * as Markers from './markers.js'
export * as Anchor from './anchor.js'
export * as MarkLook from './mark-look.js'
export * as PassageLook from './passage-look.js'
export * as CopyText from './copy-text.js'
export * as SendRequest from './send-request.js'
export * as SendSize from './send-size.js'

// The hand-off protocol's RUNTIME interface (D1 L4): what the two plugins run.
// The reference models — the backend ledger (ledgerStep) and the settled
// derivations (settledFromBatch / settledForHandoff / settledForPeer), twins of
// the Python stores held equal by the shared cases and the JS↔Python
// differential test — and the timing constants stay in handoff-protocol.js,
// imported from there by the tests that need them.
export const Handoff = Object.freeze({
  // receiving side (plugins/diple send/handoff.js)
  receiverInit: protocol.receiverInit,
  receiverStep: protocol.receiverStep,
  // sending side (the Review plugin)
  senderInit: protocol.senderInit,
  senderStep: protocol.senderStep,
  readReceipt: protocol.readReceipt,
  itemOutcomes: protocol.itemOutcomes,
  CAP_PARTIAL: protocol.CAP_PARTIAL
})
