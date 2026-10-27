// UI locales beyond zh/en, one file per locale, each with every namespace of
// the plugin (the same tree as en). A key missing in a file falls back to en;
// `node scripts/i18n-gaps.mjs` lists such gaps after zh/en gain keys.
import zhHant from './zh-hant.js'
import ja from './ja.js'
import ar from './ar.js'
import ru from './ru.js'
import fr from './fr.js'
import de from './de.js'
import es from './es.js'

export const EXTRA_LOCALES = { 'zh-hant': zhHant, ja, ar, ru, fr, de, es }
