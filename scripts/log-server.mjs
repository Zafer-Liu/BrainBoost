import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const PORT = 5174
const __dir = path.dirname(fileURLToPath(import.meta.url))
const LOG_DIR = path.join(__dir, 'logs')
const LOG_FILE = path.join(LOG_DIR, `app-${new Date().toISOString().slice(0,10)}.log`)

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true })

const LEVEL_COLOR = {
  DEBUG: '\x1b[90m',   // gray
  INFO:  '\x1b[36m',   // cyan
  WARN:  '\x1b[33m',   // yellow
  ERROR: '\x1b[31m',   // red
}
const RESET = '\x1b[0m'
const BOLD  = '\x1b[1m'

function now() {
  return new Date().toISOString().replace('T', ' ').slice(0, 23)
}

function formatLine(level, module, message, data) {
  const ts    = now()
  const lvl   = level.toUpperCase().padEnd(5)
  const mod   = module.padEnd(12)
  const color = LEVEL_COLOR[lvl.trim()] || ''
  const dataStr = data !== undefined && data !== null
    ? '  ' + (typeof data === 'string' ? data : JSON.stringify(data))
    : ''
  const plain = `${ts} [${lvl}] ${mod}: ${message}${dataStr}`
  const colored = `${color}${ts}${RESET} ${BOLD}[${lvl}]${RESET} ${color}${mod}${RESET}: ${message}${dataStr}`
  return { plain, colored }
}

const server = http.createServer((req, res) => {
  // CORS for Vite dev server on :5173
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  if (req.method === 'POST' && req.url === '/log') {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      try {
        const entries = JSON.parse(body)
        const list = Array.isArray(entries) ? entries : [entries]
        list.forEach(({ level = 'INFO', module = 'App', message = '', data }) => {
          const { plain, colored } = formatLine(level, module, message, data)
          process.stdout.write(colored + '\n')
          fs.appendFileSync(LOG_FILE, plain + '\n')
        })
      } catch {
        // malformed payload, ignore
      }
      res.writeHead(200)
      res.end()
    })
    return
  }

  res.writeHead(404)
  res.end()
})

server.listen(PORT, '127.0.0.1', () => {
  const { plain, colored } = formatLine('INFO', 'LogServer', `Listening on http://127.0.0.1:${PORT}/log`)
  process.stdout.write(colored + '\n')
  fs.appendFileSync(LOG_FILE, plain + '\n')
  const { plain: p2, colored: c2 } = formatLine('INFO', 'LogServer', `Writing to ${LOG_FILE}`)
  process.stdout.write(c2 + '\n')
  fs.appendFileSync(LOG_FILE, p2 + '\n')
})
