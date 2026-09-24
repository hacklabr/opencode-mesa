const fs = require('fs')

const configFile = process.argv[2]
const pluginPath = process.argv[3]
// Config key: "plugins" (OpenCode V2) or "plugin" (V1, also auto-normalized by V2).
const configKey = process.argv[4] || 'plugin'

if (!configFile || !pluginPath) {
  console.error('Usage: node add-plugin.cjs <config-file> <plugin-path> [plugin|plugins]')
  process.exit(1)
}

if (!fs.existsSync(configFile)) {
  fs.writeFileSync(configFile, JSON.stringify({ [configKey]: [pluginPath] }, null, 2) + '\n')
  console.log(`Created ${configFile} with plugin configured (${configKey})`)
  process.exit(0)
}

const raw = fs.readFileSync(configFile, 'utf-8')

let json = raw
let prev
do {
  prev = json
  json = json.replace(/,\s*([}\]])/g, '$1')
} while (json !== prev)

const cfg = JSON.parse(json)
if (!cfg[configKey]) cfg[configKey] = []

cfg[configKey] = cfg[configKey].filter(p => !String(p).includes('opencode-mesa'))

cfg[configKey].push(pluginPath)

// When targeting V2 ("plugins"), drop any mesa entries from the legacy V1
// "plugin" key so the plugin cannot load twice.
if (configKey === 'plugins' && Array.isArray(cfg.plugin)) {
  cfg.plugin = cfg.plugin.filter(p => !String(p).includes('opencode-mesa'))
  if (cfg.plugin.length === 0) delete cfg.plugin
}

fs.writeFileSync(configFile, JSON.stringify(cfg, null, 2) + '\n')
