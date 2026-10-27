// Which completed turn may pin a streaming capture (R5 XE5-01, ADR 0007 §5.3).
// Pure bookkeeping, no I/O.
//
//   const turns = createTurnLedger({ storedIdFor, max? })
//     storedIdFor(runtimeId) → stored id | null   (asked again on every decision:
//                                                 a pair learned later still counts)
//   turns.seq() → arrival number of the last recorded completion. A capture takes
//       it SYNCHRONOUSLY when the user captures (bind.after): only completions that
//       arrived after that moment can be the turn that was producing it.
//   turns.arrive({ turn, rid, session }) → seq   (call synchronously in the event handler)
//       session: the stored id when it is known at arrival; null = rid not mapped yet
//   turns.decide({ sessionId, after, rt }) → { turn, seq } | { blocked: true } | null
//       The FIRST completion after `after` that is of `sessionId` is the capture's
//       own turn. Completions are looked at in arrival order:
//         session known      → that session's or not;
//         session not known  → rid === rt (the runtime the capture's session ran on
//                              when it was captured) or rid === sessionId: its own;
//                              another rid while rt is known: not its own;
//                              rt unknown: it might be its own → { blocked } (the
//                              capture stays unverified until the rid is mapped).
//       null = none of the completions so far is its own turn: keep waiting.
//   turns.unresolved(since?) → number of completions after `since` still unmapped
//   turns.prune(minAfter) → forget completions no capture can still need
//
// Invariant: a capture is pinned only to the rows of a completion that arrived
// after it was captured, and only if no earlier such completion could have
// been its own turn. A later capture never joins an earlier completion, and a
// slow mapping of one completion never lets a later one take its captures.

export function createTurnLedger({ storedIdFor = () => null, max = 500 } = {}) {
  let last = 0
  let floor = 0 // completions at or below this were forgotten
  const events = [] // { seq, turn, rid, session }

  const sessionOf = (e) => e.session ?? (e.rid ? storedIdFor(e.rid) ?? null : null)

  return {
    seq: () => last,

    arrive({ turn, rid = null, session = null }) {
      last += 1
      events.push({ seq: last, turn, rid: rid || null, session: session ?? null })
      while (events.length > max) floor = events.shift().seq
      return last
    },

    decide({ sessionId, after, rt = null }) {
      if (typeof after !== 'number' || !sessionId) return null
      if (after < floor) return { blocked: true } // a completion it may need was forgotten
      for (const e of events) {
        if (e.seq <= after) continue
        const sid = sessionOf(e)
        if (sid != null) {
          if (sid === sessionId) return { turn: e.turn, seq: e.seq }
          continue
        }
        if (e.rid === sessionId || (rt && e.rid === rt)) return { turn: e.turn, seq: e.seq }
        if (rt) continue
        return { blocked: true }
      }
      return null
    },

    unresolved(since = 0) {
      return events.filter((e) => e.seq > since && sessionOf(e) == null).length
    },

    prune(minAfter) {
      while (events.length && events[0].seq <= minAfter) floor = events.shift().seq
    }
  }
}
