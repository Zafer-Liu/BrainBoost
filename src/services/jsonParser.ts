import type { MindNode, MindEdge, IdeaCard, LockedContext } from '../types'

/**
 * Stream JSON parser — incremental extraction from partial SSE text.
 *
 * Strategy: bracket-balanced scan with string-escaping awareness.
 * LLM output is never well-formed mid-stream; we extract the first
 * complete top-level array for a given key, then walk it object-by-object.
 */

// ─── Bracket-balanced array extraction ────────────────────────────
// Finds the first complete JSON array value for `key` in `text`.
export function extractArray(text: string, key: string): string | null {
  const keyIdx = text.indexOf(`"${key}"`)
  if (keyIdx === -1) return null

  const bracketStart = text.indexOf('[', keyIdx)
  if (bracketStart === -1) return null

  let depth = 0
  let inStr = false
  let esc = false

  for (let i = bracketStart; i < text.length; i++) {
    const ch = text[i]
    if (esc) { esc = false; continue }
    if (ch === '\\' && inStr) { esc = true; continue }
    if (ch === '"') { inStr = !inStr; continue }
    if (inStr) continue
    if (ch === '[') depth++
    else if (ch === ']') {
      depth--
      if (depth === 0) return text.slice(bracketStart, i + 1)
    }
  }
  return null
}

// Walks an array string and parses each complete top-level object.
export function extractObjects(arrayStr: string): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = []
  let depth = 0
  let inStr = false
  let esc = false
  let start = -1

  for (let i = 0; i < arrayStr.length; i++) {
    const ch = arrayStr[i]
    if (esc) { esc = false; continue }
    if (ch === '\\' && inStr) { esc = true; continue }
    if (ch === '"') { inStr = !inStr; continue }
    if (inStr) continue

    if (ch === '{') {
      if (depth === 0) start = i
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0 && start !== -1) {
        try {
          results.push(JSON.parse(arrayStr.slice(start, i + 1)))
        } catch { /* skip malformed */ }
        start = -1
      }
    }
  }
  return results
}

/**
 * Strip all <think>…</think> blocks from text. Handles multiple blocks.
 * If a <think> is still open (no closing tag), strips from <think> to end.
 */
export function stripThinkBlocks(text: string): string {
  // First, remove all closed <think>…</think> blocks (non-greedy, repeated)
  let out = text.replace(/<think>[\s\S]*?<\/think>/g, '')
  // Then handle an unclosed <think> (streaming mid-block)
  const openIdx = out.indexOf('<think>')
  if (openIdx >= 0) out = out.slice(0, openIdx)
  return out
}

/**
 * Extract the outermost JSON object {...} from text that may contain
 * leading prose ("好的，这是结果：" etc.) or trailing commentary.
 * Returns null if no balanced object is found.
 */
export function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) return null

  let depth = 0
  let inStr = false
  let esc = false

  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (esc) { esc = false; continue }
    if (ch === '\\' && inStr) { esc = true; continue }
    if (ch === '"') { inStr = !inStr; continue }
    if (inStr) continue

    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null  // unbalanced — still streaming
}

// ─── Stream-stage extraction ──────────────────────────────────────

/** Try to extract a complete { nodes, edges } pair from partial stream text. */
export function tryExtractMindMap(partial: string): { nodes: MindNode[]; edges: MindEdge[] } | null {
  const nodesStr = extractArray(partial, 'nodes')
  if (!nodesStr) return null

  try {
    // Lazy import to avoid circular dep on uuid
    const nodes: MindNode[] = extractObjects(nodesStr).map(n => ({
      id: (n.id as string) || crypto.randomUUID(),
      label: (n.label as string) || '',
      group: n.group as string | undefined,
      keywords: (n.keywords as string[]) || [],
    }))
    if (nodes.length === 0) return null

    const edgesStr = extractArray(partial, 'edges')
    // Only return a result if we have at least some edges too —
    // this avoids triggering onMindMap with edges:0 when the model
    // outputs nodes before edges (common with thinking models).
    // Exception: if "ideaCards" keyword appears, the edges section
    // is already past us (model skipped or done), so emit with what we have.
    const hasIdeaCards = partial.includes('"ideaCards"')
    if (!edgesStr && !hasIdeaCards) return null

    const edges: MindEdge[] = edgesStr
      ? extractObjects(edgesStr).map(e => ({
          source: (e.source as string) || '',
          target: (e.target as string) || '',
          label: e.label as string | undefined,
        }))
      : []

    return { nodes, edges }
  } catch {
    return null
  }
}

/** Extract ideaCards that appeared after `knownCount` cards were already streamed. */
export function extractNewCards(partial: string, knownCount: number): IdeaCard[] {
  const cardsStr = extractArray(partial, 'ideaCards')
  if (!cardsStr) return []

  const all = extractObjects(cardsStr).map(obj => ({
    id: crypto.randomUUID(),
    title: (obj.title as string) || '',
    content: (obj.content as string) || '',
    relatedKeywords: (obj.relatedKeywords as string[]) || [],
    relatedNodeIds: (obj.relatedNodeIds as string[]) || [],
    createdAt: Date.now(),
  }))
  return all.slice(knownCount)
}

/** Parse a complete keyword-analysis JSON response (with markdown fences stripped). */
export function parseKeywordAnalysis(full: string): unknown {
  const cleaned = stripThinkBlocks(full)
    .replace(/^```[\w]*\n?/, '')
    .replace(/\n?```$/, '')
    .trim()
  return JSON.parse(cleaned)
}

export type { LockedContext }
