type Level = 'debug' | 'info' | 'warn' | 'error'

const LOG_SERVER = 'http://127.0.0.1:5174/log'

const COLORS: Record<Level, string> = {
  debug: '#94a3b8',
  info:  '#5b5ef7',
  warn:  '#d97706',
  error: '#dc2626',
}

// Batch entries and flush every 200ms to avoid per-keystroke HTTP requests
const queue: Array<{ level: string; module: string; message: string; data?: unknown }> = []
let flushTimer: ReturnType<typeof setTimeout> | null = null

function scheduleFlush() {
  if (flushTimer !== null) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    if (queue.length === 0) return
    const batch = queue.splice(0)
    fetch(LOG_SERVER, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batch),
    }).catch(() => { /* log server not running, silently ignore */ })
  }, 200)
}

function log(level: Level, module: string, message: string, data?: unknown) {
  // Browser console with colors
  const time = new Date().toISOString().slice(11, 23)
  const style = `color:${COLORS[level]};font-weight:600`
  const tag = `%c[${time}] [${level.toUpperCase()}] [${module}]`
  if (data !== undefined) {
    console[level === 'debug' ? 'log' : level](tag, style, message, data)
  } else {
    console[level === 'debug' ? 'log' : level](tag, style, message)
  }

  // Forward to log server (batched)
  queue.push({ level: level.toUpperCase(), module, message, data })
  scheduleFlush()
}

export const logger = {
  debug: (module: string, msg: string, data?: unknown) => log('debug', module, msg, data),
  info:  (module: string, msg: string, data?: unknown) => log('info',  module, msg, data),
  warn:  (module: string, msg: string, data?: unknown) => log('warn',  module, msg, data),
  error: (module: string, msg: string, data?: unknown) => log('error', module, msg, data),
}
