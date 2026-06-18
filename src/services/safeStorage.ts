/**
 * Safe localStorage wrapper with quota protection.
 *
 * Catches QuotaExceededError so the app degrades gracefully to in-memory mode
 * instead of silently breaking on every subsequent write.
 * Also supports simple obfuscation of sensitive values (API Key etc.)
 * to avoid plaintext visibility in DevTools → Application → Local Storage.
 */

const MOD = 'SafeStorage'

export interface SafeStorageResult {
  ok: boolean
  error?: string
}

/** Plain JSON write with quota guard. Returns ok=false on QuotaExceededError. */
export function safeSetJSON(key: string, value: unknown): SafeStorageResult {
  try {
    const raw = JSON.stringify(value)
    localStorage.setItem(key, raw)
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (e instanceof DOMException && (e.name === 'QuotaExceededError' || e.code === 22)) {
      console.warn(`[${MOD}] localStorage 配额已满，key="${key}" 写入失败，应用将仅在内存中保存数据，刷新后丢失。建议导出重要会话或删除旧会话。`)
      return { ok: false, error: 'QUOTA_EXCEEDED' }
    }
    console.warn(`[${MOD}] localStorage 写入失败 key="${key}"`, e)
    return { ok: false, error: msg }
  }
}

/** Plain JSON read with parse guard. Returns fallback on any error. */
export function safeGetJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch (e) {
    console.warn(`[${MOD}] localStorage 读取失败 key="${key}"`, e)
    return fallback
  }
}

/** Remove a key. */
export function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch { /* ignore */ }
}

// ─── Obfuscated storage for sensitive values (API Key) ────────────
//
// This is NOT real encryption — it's XOR + base64 to keep API keys
// out of plain sight in DevTools. A determined attacker with file
// system access or XSS can still recover the key. For real protection,
// move LLM calls to a backend proxy.

const OBF_SALT = 'brainspark-v0.1-salt-2026'  // per-app constant

function xorEncode(plain: string): string {
  let out = ''
  for (let i = 0; i < plain.length; i++) {
    out += String.fromCharCode(plain.charCodeAt(i) ^ OBF_SALT.charCodeAt(i % OBF_SALT.length))
  }
  // btoa needs Latin-1; convert via Uint8Array to handle all char codes safely
  const bytes = new Uint8Array(out.length)
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff
  let bin = ''
  bytes.forEach(b => { bin += String.fromCharCode(b) })
  return btoa(bin)
}

function xorDecode(encoded: string): string {
  let bin = ''
  try {
    bin = atob(encoded)
  } catch {
    return ''  // not valid base64 → treat as empty/legacy
  }
  let out = ''
  for (let i = 0; i < bin.length; i++) {
    out += String.fromCharCode(bin.charCodeAt(i) ^ OBF_SALT.charCodeAt(i % OBF_SALT.length))
  }
  return out
}

/**
 * Detect legacy plaintext storage and transparently migrate to obfuscated form.
 * Returns the decoded value and rewrites storage if migration occurred.
 */
export function safeGetObfuscated(key: string, fallback = ''): string {
  const raw = localStorage.getItem(key)
  if (!raw) return fallback

  // Heuristic: if it doesn't look like base64 (has chars outside A-Za-z0-9+/=), treat as legacy plaintext
  if (!/^[A-Za-z0-9+/=]*$/.test(raw)) {
    // Legacy plaintext — migrate
    safeSetObfuscated(key, raw)
    return raw
  }

  const decoded = xorDecode(raw)
  // If decoded looks like garbage (control chars), probably was actually base64 but not ours
  if (decoded && /[\x00-\x08\x0E-\x1F]/.test(decoded)) {
    return raw  // leave as-is
  }
  return decoded || fallback
}

export function safeSetObfuscated(key: string, value: string): void {
  try {
    localStorage.setItem(key, xorEncode(value))
  } catch (e) {
    console.warn(`[${MOD}] obfuscated write failed key="${key}"`, e)
  }
}
