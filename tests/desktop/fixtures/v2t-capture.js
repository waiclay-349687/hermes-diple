// Test-only entry (V2-T): the Diple plugin with the capture group alone, its
// deps exposed so a test can drive the uiBus, the lists and the settings.
import { createDeps } from '../../../plugins/diple/desktop/src/index.js'
import { installCapture } from '../../../plugins/diple/desktop/src/capture/index.js'

export default {
  id: 'diple',
  name: 'Diple (capture only, test)',
  register(ctx) {
    const deps = createDeps(ctx)
    globalThis.__v2tDeps = deps
    ctx.onDispose(deps.live.dispose)
    installCapture(ctx, deps)
  }
}
