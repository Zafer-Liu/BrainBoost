import type { LLMConfig } from '../types'
import { logger } from './logger'

const MOD = 'LLMStream'

/**
 * Resolve Claude API base URL. Honors config.claudeBaseURL, falls back to official.
 */
function claudeBaseURL(config: LLMConfig): string {
  return config.claudeBaseURL?.trim() || 'https://api.anthropic.com'
}

/**
 * Resolve OpenAI-compatible base URL.
 */
function openaiBaseURL(config: LLMConfig): string {
  return config.baseURL?.trim() || 'https://api.openai.com/v1'
}

/** Build fetch Request for a streaming chat request. Returns the request promise. */
export function buildStreamRequest(
  config: LLMConfig,
  messages: { role: string; content: string }[],
  maxTokens: number,
): { resp: Promise<Response> } {
  if (config.provider === 'claude') {
    const headers: Record<string, string> = {
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    }
    // Anthropic requires this header for any browser-side request (CORS).
    // Without it the request is rejected regardless of origin.
    headers['anthropic-dangerous-request-header'] = 'true'
    return {
      resp: fetch(`${claudeBaseURL(config)}/v1/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: config.model || 'claude-sonnet-4-6',
          max_tokens: maxTokens,
          stream: true,
          messages,
        }),
      }),
    }
  }

  const body: Record<string, unknown> = {
    model: config.model || 'gpt-4o',
    messages,
    max_tokens: maxTokens,
    stream: true,
  }
  if (config.disableThinking) {
    body.thinking = { type: 'disabled' }
  }
  return {
    resp: fetch(`${openaiBaseURL(config)}/chat/completions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  }
}

// ─── SSE stream reader ────────────────────────────────────────────

/** Read an SSE stream, invoking onChunk with the accumulated full text per delta. */
export async function readStream(
  resp: Response,
  provider: 'claude' | 'openai' | 'custom',
  onChunk: (partial: string) => void,
): Promise<string> {
  const reader = resp.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  let firstChunk = true

  function processLine(line: string) {
    if (!line.startsWith('data: ')) return
    const data = line.slice(6).trim()
    if (data === '[DONE]') return

    try {
      const json = JSON.parse(data)
      let delta = ''

      if (provider === 'claude') {
        if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta') {
          delta = json.delta.text ?? ''
        }
      } else {
        delta = json.choices?.[0]?.delta?.content ?? ''
      }

      if (delta) {
        full += delta
        onChunk(full)
      }
    } catch { /* incomplete SSE line, skip */ }
  }

  let chunkCount = 0
  let lastChunkTime = Date.now()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    const now = Date.now()
    const gap = now - lastChunkTime
    lastChunkTime = now
    chunkCount++
    buffer += decoder.decode(value, { stream: true })

    if (firstChunk) {
      firstChunk = false
      logger.debug(MOD, 'SSE 首个 chunk', { preview: buffer.slice(0, 200) })
    }
    if (chunkCount <= 5 || chunkCount % 20 === 0) {
      logger.debug(MOD, `chunk #${chunkCount}`, { gap_ms: gap, bufLen: buffer.length, fullLen: full.length })
    }

    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) processLine(line.trimEnd())
  }

  if (buffer.trim()) processLine(buffer.trim())

  logger.debug(MOD, 'full 文本预览', { head: full.slice(0, 150), tail: full.slice(-150) })
  return full
}

/**
 * Generic streaming chat request. Returns the stripped full text via onDone.
 * Used by writePlanDetail / chatWithPlan / analyzeKeywords.
 */
export async function streamRequest(
  config: LLMConfig,
  messages: { role: string; content: string }[],
  onChunk: (text: string) => void,
  onDone: (full: string) => void,
  onError: (err: Error) => void,
  maxTokens = 8000,
): Promise<void> {
  try {
    const { resp: respPromise } = buildStreamRequest(config, messages, maxTokens)
    const resp = await respPromise

    if (!resp.ok) {
      const err = await resp.text()
      onError(new Error(`API 错误 ${resp.status}: ${err}`))
      return
    }

    const full = await readStream(resp, config.provider, onChunk)
    // Strip think block before returning final result
    const thinkEnd = full.lastIndexOf('</think>')
    onDone(thinkEnd >= 0 ? full.slice(thinkEnd + 8).trim() : full.trim())
  } catch (e) {
    onError(e instanceof Error ? e : new Error(String(e)))
  }
}
