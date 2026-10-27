// Install the plugin into a Hermes home. --home is REQUIRED: this script
// never guesses ~/.hermes.
//
//   node scripts/install.mjs --home <HERMES_HOME> [--no-build] [--no-enable]
//
// Copies
//   dist/<id>/plugin.js        → <home>/desktop-plugins/<id>/plugin.js
//   plugins/<id>/python/       → <home>/plugins/<id>/
// and adds the id to plugins.enabled in <home>/config.yaml (through the
// Hermes venv's PyYAML, so the rest of the file is preserved as YAML).
// The running app must be restarted for the Python half to load.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildPlugin, PLUGINS } from './build.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const value = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

const homeArg = value('--home')
if (!homeArg) {
  console.error('install.mjs: refusing to run without --home <HERMES_HOME> (it never defaults to ~/.hermes).')
  process.exit(2)
}
const home = path.resolve(homeArg.replace(/^~(?=\/|$)/, os.homedir()))
if (!fs.existsSync(home)) {
  console.error(`install.mjs: ${home} does not exist`)
  process.exit(2)
}

if (!flag('--no-build')) for (const id of PLUGINS) await buildPlugin(id)

const ignore = new Set(['__pycache__', '.pytest_cache', '.DS_Store'])
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (ignore.has(entry.name) || entry.name.endsWith('.pyc')) continue
    const s = path.join(src, entry.name)
    const d = path.join(dst, entry.name)
    if (entry.isDirectory()) copyDir(s, d)
    else fs.copyFileSync(s, d)
  }
}

for (const id of PLUGINS) {
  const bundle = path.join(root, 'dist', id, 'plugin.js')
  if (!fs.existsSync(bundle)) throw new Error(`missing ${bundle}; run npm run build`)
  const desktopDir = path.join(home, 'desktop-plugins', id)
  fs.mkdirSync(desktopDir, { recursive: true })
  fs.copyFileSync(bundle, path.join(desktopDir, 'plugin.js'))
  const pyDst = path.join(home, 'plugins', id)
  fs.rmSync(pyDst, { recursive: true, force: true })
  copyDir(path.join(root, 'plugins', id, 'python'), pyDst)
  console.log(`installed ${id} → ${path.relative(home, desktopDir)}/plugin.js, plugins/${id}/`)
}

if (!flag('--no-enable')) {
  const agent = process.env.HERMES_AGENT_ROOT ?? path.join(os.homedir(), '.hermes', 'hermes-agent')
  const py = path.join(agent, 'venv', 'bin', 'python')
  const script = `
import sys, yaml, pathlib
cfg = pathlib.Path(sys.argv[1]) / "config.yaml"
data = yaml.safe_load(cfg.read_text()) if cfg.exists() else None
data = data if isinstance(data, dict) else {}
plugins = data.get("plugins") if isinstance(data.get("plugins"), dict) else {}
enabled = list(plugins.get("enabled") or [])
for name in sys.argv[2:]:
    if name not in enabled:
        enabled.append(name)
disabled = [n for n in (plugins.get("disabled") or []) if n not in sys.argv[2:]]
plugins["enabled"] = enabled
if "disabled" in plugins:
    plugins["disabled"] = disabled
data["plugins"] = plugins
cfg.write_text(yaml.safe_dump(data, allow_unicode=True, sort_keys=False))
print("plugins.enabled =", enabled)
`
  execFileSync(py, ['-c', script, home, ...PLUGINS], { stdio: 'inherit' })
}
