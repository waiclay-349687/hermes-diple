// Test-only entry: the Diple plugin with the send group alone (no capture),
// so the `locate` service is absent and marker clicks take the fallback.
import { createDeps } from '../../../plugins/diple/desktop/src/index.js'
import { installSend } from '../../../plugins/diple/desktop/src/send/index.js'

export default {
  id: 'diple',
  name: 'Diple (send only, test)',
  register(ctx) {
    installSend(ctx, createDeps(ctx))
  }
}
