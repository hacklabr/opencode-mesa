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

if (Array.isArray(cfg.plugin)) {
  const before = cfg.plugin.length
  cfg.plugin = cfg.plugin.filter(p => typeof p === 'string' && !p.includes('opencode-mesa'))
  const removed = before - cfg.plugin.length

  fs.writeFileSync(configFile, JSON.stringify(cfg, null, 2) + '\n')

  if (removed > 0) {
    console.log(`Removed ${removed} plugin entry(ies) from ${configFile}`)
  } else {
    console.log(`No plugin entries found in ${configFile}`)
  }
} else {
  console.log(`No plugin array in ${configFile}`)
}
