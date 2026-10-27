// Client of the Diple backend (/api/plugins/diple/…). W1-owned.
// Every method returns a Promise; HTTP errors reject with { status, message }.

export function createApi(rest) {
  const enc = encodeURIComponent
  return {
    health: () => rest('/health'),
    // handoffIds: the hand-offs whose items ride in this batch (ADR 0007 §5)
    putBatch: (batchId, { sessionId, full, display, items, handoffIds, handoffItems }) =>
      rest(`/batches/${enc(batchId)}`, {
        method: 'PUT',
        body: { sessionId, full, display, items, ...(handoffIds?.length ? { handoffIds } : {}), ...(handoffItems && Object.keys(handoffItems).length ? { handoffItems } : {}) }
      }),
    getBatch: (batchId) => rest(`/batches/${enc(batchId)}`),
    listBatches: ({ sessionId, status, limit } = {}) => {
      const q = new URLSearchParams()
      if (sessionId) q.set('sessionId', sessionId)
      if (status) q.set('status', status)
      if (limit) q.set('limit', String(limit))
      const qs = q.toString()
      return rest(`/batches${qs ? `?${qs}` : ''}`)
    },
    markAnswered: (batchId, { answered, missing, noMarkers }) =>
      rest(`/batches/${enc(batchId)}/answered`, { method: 'POST', body: { answered, missing, noMarkers } }),
    // rejected: the host refused the turn after expanding the batch (expanded → failed)
    markFailed: (batchId, reason, { rejected = false } = {}) =>
      rest(`/batches/${enc(batchId)}/failed`, { method: 'POST', body: rejected ? { reason, rejected: true } : { reason } }),
    // ADR 0007: { owner, batchId, caps } → { claimed, owner, generation, batchId, progress? } | { claimed: false, receipt?, settled? }
    // caps: the hand-off payload's (R5 XE5-02) — what its sender may be told
    claimHandoff: (handoffId, sessionId, { owner, batchId, caps } = {}) =>
      rest(`/handoff/${enc(handoffId)}/claim`, { method: 'POST', body: { sessionId, ...(owner ? { owner } : {}), ...(batchId ? { batchId } : {}), ...(caps?.length ? { caps } : {}) } }),
    // numbers: the backend takes the origins from the stored batch (answered is the fallback)
    emitBatchAnswered: (batchId, answered, numbers) =>
      rest('/events/batch-answered', { method: 'POST', body: { batchId, answered, ...(numbers ? { numbers } : {}) } }),
    // CAS on the claim before each side effect (XE2-03, ADR 0007); 409 lost-claim = stop
    saveHandoffProgress: (handoffId, { owner, generation, stage, accepted }) =>
      rest(`/handoff/${enc(handoffId)}/progress`, { method: 'POST', body: { owner, generation, stage, accepted } }),
    // { handoffId, owner, generation, accepted, batchId?, queued? }; 409 lost-claim.
    // settles: this receiver settles every sendNow hand-off (ADR 0007 §6) — the review
    // side then believes only handoff.settled, never its own inference
    emitHandoffReceipt: (receipt) => rest('/events/handoff-receipt', { method: 'POST', body: { ...receipt, settles: true } }),
    // broadcast again the stored receipt and settled (derived from the batch when missing)
    replayHandoff: (handoffId) => rest(`/handoff/${enc(handoffId)}/replay`, { method: 'POST', body: {} }),
    // how the send of a batch ended, for every hand-off in it (ADR 0007 §4): stored once, broadcast
    finalBatch: (batchId, { delivered, reason, handoffIds }) =>
      rest(`/batches/${enc(batchId)}/final`, { method: 'POST', body: { delivered, handoffIds, ...(reason && !delivered ? { reason } : {}) } })
  }
}
