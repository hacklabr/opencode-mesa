const fs = require('fs')

const configFile = process.argv[2]
const pluginPath = process.argv[3]

if (!configFile || !pluginPath) {
  console.error('Usage: node add-plugin.js <config-file> <plugin-path>')
  process.exit(1)
}

const raw = fs.readFileSync(configFile, 'utf-8')

let json = raw
let prev
do {
  prev = json
  json = json.replace(/,\s*([}\]])/g, '$1')
} while (json !== prev)

const cfg = JSON.parse(json)
if (!cfg.plugin) cfg.plugin = []

cfg.plugin = cfg.plugin.filter(p => !p.includes('opencode-mesa'))

cfg.plugin.push(pluginPath)

fs.writeFileSync(configFile, JSON.stringify(cfg, null, 2) + '\n')
