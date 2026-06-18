type Level = 'debug' | 'info' | 'warn' | 'error'

// 日志服务地址：通过环境变量配置，留空则禁用日志上报
// 开发环境运行 scripts/log-server.mjs（端口 5174）；生产环境留空避免无效请求
const LOG_SERVER = import.meta.env.VITE_LOG_SERVER ?? ''

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
    // 仅在配置了日志服务地址时上报，避免生产环境无效请求 / CORS 警告
    if (!LOG_SERVER) return
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
