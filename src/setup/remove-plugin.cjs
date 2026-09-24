const fs = require('fs')

const configFile = process.argv[2]

if (!configFile) {
  console.error('Usage: node remove-plugin.cjs <config-file>')
  process.exit(1)
}

if (!fs.existsSync(configFile)) {
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

let removed = 0
// Covers both the V1 key ("plugin") and the V2 key ("plugins").
for (const key of ['plugin', 'plugins']) {
  if (Array.isArray(cfg[key])) {
    const before = cfg[key].length
    cfg[key] = cfg[key].filter(p => typeof p === 'string' && !p.includes('opencode-mesa'))
    removed += before - cfg[key].length
    if (cfg[key].length === 0) delete cfg[key]
  }
}

if (removed > 0) {
  fs.writeFileSync(configFile, JSON.stringify(cfg, null, 2) + '\n')
  console.log(`Removed ${removed} plugin entry(ies) from ${configFile}`)
} else {
  console.log(`No plugin entries found in ${configFile}`)
}
