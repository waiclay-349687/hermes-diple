// Test-only entry (fix-a, R1): the Diple desktop modules behind their own
// interfaces — createSendFlow, createListStore, createHandoffReceiver,
// createOriginResolver, rangeToMarkdown, createLive, createBatchCatalog — built against the SDK stub.
import { createSendFlow } from '../../../plugins/diple/desktop/src/send/send-flow.js'
import { createHandoffReceiver } from '../../../plugins/diple/desktop/src/send/handoff.js'
import { createSending, bindSending } from '../../../plugins/diple/desktop/src/send/sending.js'
import { createLive } from '../../../plugins/diple/desktop/src/shared/live.js'
import { createListStore } from '../../../plugins/diple/desktop/src/shared/list-store.js'
import { newBatchId } from '../../../plugins/diple/desktop/src/shared/ids.js'
import { createBatchCatalog } from '../../../plugins/diple/desktop/src/shared/batch-catalog.js'
import { createOriginResolver } from '../../../plugins/diple/desktop/src/capture/origin.js'
import { rangeToMarkdown } from '../../../plugins/diple/desktop/src/capture/markdown.js'

export default { createSendFlow, createHandoffReceiver, createLive, createListStore, createOriginResolver, rangeToMarkdown, newBatchId, createBatchCatalog, createSending, bindSending }
