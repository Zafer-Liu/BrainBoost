import type { LLMConfig, MindNode, MindEdge, IdeaCard, ChatMessage } from '../types'

export interface LockedContext {
  nodes: MindNode[]
  cards: IdeaCard[]
}
import { v4 as uuidv4 } from 'uuid'
import { logger } from './logger'

const MOD = 'LLMService'

export interface AnalysisResult {
  nodes: MindNode[]
  edges: MindEdge[]
  ideaCards: IdeaCard[]
}

export interface StreamCallbacks {
  onMindMap: (nodes: MindNode[], edges: MindEdge[]) => void
  onIdeaCard: (card: IdeaCard) => void
  onDone: (result: AnalysisResult) => void
  onError: (err: Error) => void
}

function buildPrompt(topic: string, keywords: string[], notes?: string, locked?: LockedContext): string {
  const notesSection = notes?.trim()
    ? `\n背景备注与要求（优先参考）：\n${notes.trim()}\n`
    : ''

  let lockedSection = ''
  if (locked && (locked.nodes.length > 0 || locked.cards.length > 0)) {
    lockedSection = '\n【锁定内容——必须保留，id 和 label 原样输出到结果中】\n'
    if (locked.nodes.length > 0) {
      lockedSection += '已锁定节点（nodes 中必须包含这些，id 和 label 不变）：\n'
      lockedSection += locked.nodes.map(n =>
        `  - id: "${n.id}", label: "${n.label}", group: "${n.group ?? ''}"`
      ).join('\n') + '\n'
    }
    if (locked.cards.length > 0) {
      lockedSection += '已锁定方案（ideaCards 中必须包含这些，title 和 content 不变）：\n'
      lockedSection += locked.cards.map(c =>
        `  - title: "${c.title}", content: "${c.content}"`
      ).join('\n') + '\n'
    }
    lockedSection += '可在锁定内容基础上新增节点和方案，优化连接关系，但不得修改或删除上述锁定项。\n'
  }

  return `你是头脑风暴分析助手。主题："${topic}"，关键词：

${keywords.map((k, i) => `${i + 1}. ${k}`).join('\n')}
${notesSection}${lockedSection}
思考完成后，只输出如下 JSON，不要任何多余文字或代码块标记：

{
  "nodes": [
    { "id": "n1", "label": "节点名称（8字以内）", "group": "分组名", "keywords": ["关键词"] }
  ],
  "edges": [
    { "source": "n1", "target": "n2", "label": "关联说明（6字以内）" }
  ],
  "ideaCards": [
    {
      "title": "方案标题",
      "content": "方案详细描述（150字以内）",
      "relatedKeywords": ["关键词"],
      "relatedNodeIds": ["n1", "n2"]
    }
  ]
}

要求：
- nodes：围绕每个关键词展开 2-4 个子节点，共 15-25 个节点，分 4-6 个分组，label 用清晰易懂的词语（非缩写）
- edges：20-30 条，充分连接相关节点，label 说明两节点间的具体关联关系
- ideaCards：3-5 个具体可执行方案，每个方案的 relatedNodeIds 必须引用上面 nodes 里真实存在的 id（至少 3 个）
- 所有文字用中文`
}

// ─── 括号平衡提取数组 ──────────────────────────────────────────────
// 从 text 中找到 key 对应的完整 JSON 数组（正确处理嵌套）
function extractArray(text: string, key: string): string | null {
  const keyIdx = text.indexOf(`"${key}"`)
  if (keyIdx === -1) return null

  // 找到 key 后面第一个 [
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

// 从数组字符串中逐个提取完整 JSON 对象
function extractObjects(arrayStr: string): Record<string, unknown>[] {
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

// ─── SSE 流式读取 ─────────────────────────────────────────────────
async function readStream(
  resp: Response,
  provider: 'claude' | 'openai' | 'custom',
  onChunk: (partial: string) => void
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

// ─── 流式增量解析 ─────────────────────────────────────────────────
function tryExtractMindMap(partial: string): { nodes: MindNode[]; edges: MindEdge[] } | null {
  const nodesStr = extractArray(partial, 'nodes')
  if (!nodesStr) return null

  try {
    const nodes: MindNode[] = extractObjects(nodesStr).map(n => ({
      id: (n.id as string) || uuidv4(),
      label: (n.label as string) || '',
      group: n.group as string | undefined,
      keywords: (n.keywords as string[]) || [],
    }))
    if (nodes.length === 0) return null

    const edgesStr = extractArray(partial, 'edges')
    // Only return a result if we have at least some edges too —
    // this avoids triggering onMindMap with edges:0 when the model
    // outputs nodes before edges (common with thinking models).
    // Exception: if "ideaCards" keyword appears, we know edges section
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

function extractNewCards(partial: string, knownCount: number): IdeaCard[] {
  const cardsStr = extractArray(partial, 'ideaCards')
  if (!cardsStr) return []

  const all = extractObjects(cardsStr).map(obj => ({
    id: uuidv4(),
    title: (obj.title as string) || '',
    content: (obj.content as string) || '',
    relatedKeywords: (obj.relatedKeywords as string[]) || [],
    relatedNodeIds: (obj.relatedNodeIds as string[]) || [],
    createdAt: Date.now(),
  }))
  return all.slice(knownCount)
}

// ─── 主入口 ───────────────────────────────────────────────────────
export async function analyzeKeywordsStream(
  config: LLMConfig,
  topic: string,
  keywords: string[],
  callbacks: StreamCallbacks,
  notes?: string,
  locked?: LockedContext,
): Promise<void> {
  if (!config.apiKey) { callbacks.onError(new Error('请先在设置中填写 API Key')); return }
  if (keywords.length < 2) { callbacks.onError(new Error('至少需要 2 个关键词才能分析')); return }

  logger.info(MOD, '开始流式分析', { topic, count: keywords.length, hasNotes: !!notes?.trim(), lockedNodes: locked?.nodes.length ?? 0, lockedCards: locked?.cards.length ?? 0 })
  const prompt = buildPrompt(topic, keywords, notes, locked)
  const t0 = Date.now()

  let mindMapSent = false
  let knownCardCount = 0
  // Keep streaming results for onDone — avoid re-parsing full
  let streamedNodes: MindNode[] = []
  let streamedEdges: MindEdge[] = []
  let streamedCards: IdeaCard[] = []

  const onChunk = (partial: string) => {
    // If the response contains <think>, only parse AFTER </think> closes.
    // While still inside <think> (no closing tag yet), skip parsing entirely —
    // the model may be quoting the prompt's JSON template inside its reasoning.
    const thinkOpen = partial.includes('<think>')
    const thinkEnd = partial.lastIndexOf('</think>')
    if (thinkOpen && thinkEnd === -1) return   // still inside <think>, skip
    const parseable = thinkEnd >= 0 ? partial.slice(thinkEnd + 8) : partial

    // Always try to extract nodes+edges — even after first mindMap sent,
    // so we can capture edges that arrive after nodes are complete.
    const mm = tryExtractMindMap(parseable)
    if (mm) {
      const edgesImproved = mm.edges.length > streamedEdges.length
      if (!mindMapSent) {
        logger.info(MOD, '思维导图流式就绪', { nodes: mm.nodes.length, edges: mm.edges.length })
        mindMapSent = true
        streamedNodes = mm.nodes
        streamedEdges = mm.edges
        callbacks.onMindMap(mm.nodes, mm.edges)
      } else if (edgesImproved) {
        // Edges arrived after nodes — update silently, onDone will use latest
        logger.info(MOD, '补充 edges', { edges: mm.edges.length })
        streamedEdges = mm.edges
      }
    }

    const newCards = extractNewCards(parseable, knownCardCount)
    for (const card of newCards) {
      knownCardCount++
      streamedCards.push(card)
      logger.info(MOD, `方案卡片 #${knownCardCount} 就绪`, { title: card.title })
      callbacks.onIdeaCard(card)
    }
  }

  try {
    let resp: Response

    if (config.provider === 'claude') {
      resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          'anthropic-dangerous-request-header': 'true',
        },
        body: JSON.stringify({
          model: config.model || 'claude-sonnet-4-6',
          max_tokens: 100000,
          stream: true,
          messages: [{ role: 'user', content: prompt }],
        }),
      })
    } else {
      const baseURL = config.baseURL || 'https://api.openai.com/v1'
      const body: Record<string, unknown> = {
        model: config.model || 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 100000,
        stream: true,
      }
      if (config.disableThinking) {
        body.thinking = { type: 'disabled' }
      }
      resp = await fetch(`${baseURL}/chat/completions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    }

    logger.debug(MOD, `HTTP ${resp.status} ${resp.statusText}`)

    if (!resp.ok) {
      const err = await resp.text()
      logger.error(MOD, 'API 失败', { status: resp.status, body: err })
      callbacks.onError(new Error(`API 错误 ${resp.status}: ${err}`))
      return
    }

    const full = await readStream(resp, config.provider, onChunk)
    logger.info(MOD, `流式完成，耗时 ${Date.now() - t0}ms`, { chars: full.length })

    // Strip <think> block before fallback parse too
    const thinkEnd = full.lastIndexOf('</think>')
    const parseable = thinkEnd >= 0 ? full.slice(thinkEnd + 8) : full

    // Fallback full parse for nodes (if streaming missed them)
    if (streamedNodes.length === 0) {
      logger.warn(MOD, '流式未能提取思维导图，尝试全量解析')
      const nodesStr = extractArray(parseable, 'nodes')
      if (nodesStr) streamedNodes = extractObjects(nodesStr).map(n => ({ id: (n.id as string) || uuidv4(), label: (n.label as string) || '', group: n.group as string | undefined, keywords: (n.keywords as string[]) || [] }))
    }
    // Always attempt fallback for edges — streaming often captures nodes before edges arrive
    if (streamedEdges.length === 0) {
      const edgesStr = extractArray(parseable, 'edges')
      if (edgesStr) {
        const parsed = extractObjects(edgesStr).map(e => ({ source: (e.source as string) || '', target: (e.target as string) || '', label: e.label as string | undefined }))
        if (parsed.length > 0) {
          logger.info(MOD, `全量解析补充 edges`, { count: parsed.length })
          streamedEdges = parsed
        }
      }
    }
    if (streamedCards.length === 0) {
      logger.warn(MOD, '流式未能提取方案卡片，尝试全量解析')
      const cardsStr = extractArray(parseable, 'ideaCards')
      if (cardsStr) streamedCards = extractObjects(cardsStr).map(c => ({ id: uuidv4(), title: (c.title as string) || '', content: (c.content as string) || '', relatedKeywords: (c.relatedKeywords as string[]) || [], relatedNodeIds: (c.relatedNodeIds as string[]) || [], createdAt: Date.now() }))
    }

    // Re-apply locked flag to nodes/cards returned by AI (AI strips unknown fields)
    if (locked) {
      const lockedNodeIds = new Set(locked.nodes.map(n => n.id))
      const lockedCardTitles = new Set(locked.cards.map(c => c.title))
      streamedNodes = streamedNodes.map(n => lockedNodeIds.has(n.id) ? { ...n, locked: true } : n)
      streamedCards = streamedCards.map(c => lockedCardTitles.has(c.title) ? { ...c, locked: true } : c)
      // If AI dropped any locked nodes/cards entirely, re-insert them
      for (const ln of locked.nodes) {
        if (!streamedNodes.find(n => n.id === ln.id)) streamedNodes.push(ln)
      }
      for (const lc of locked.cards) {
        if (!streamedCards.find(c => c.title === lc.title)) streamedCards.push(lc)
      }
    }

    logger.info(MOD, '最终结果', { nodes: streamedNodes.length, edges: streamedEdges.length, ideaCards: streamedCards.length })
    callbacks.onDone({ nodes: streamedNodes, edges: streamedEdges, ideaCards: streamedCards })

  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e))
    logger.error(MOD, '流式分析失败', { error: err.message })
    callbacks.onError(err)
  }
}

// ─── 通用流式请求（用于方案书写和对话） ──────────────────────────
async function streamRequest(
  config: LLMConfig,
  messages: { role: string; content: string }[],
  onChunk: (text: string) => void,
  onDone: (full: string) => void,
  onError: (err: Error) => void,
): Promise<void> {
  try {
    let resp: Response
    if (config.provider === 'claude') {
      resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          'anthropic-dangerous-request-header': 'true',
        },
        body: JSON.stringify({
          model: config.model || 'claude-sonnet-4-6',
          max_tokens: 8000,
          stream: true,
          messages,
        }),
      })
    } else {
      const baseURL = config.baseURL || 'https://api.openai.com/v1'
      resp = await fetch(`${baseURL}/chat/completions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.model || 'gpt-4o',
          messages,
          max_tokens: 8000,
          stream: true,
        }),
      })
    }
    if (!resp.ok) {
      const err = await resp.text()
      onError(new Error(`API 错误 ${resp.status}: ${err}`)); return
    }
    const full = await readStream(resp, config.provider, onChunk)
    // Strip think block from final result too
    const thinkEnd = full.lastIndexOf('</think>')
    onDone(thinkEnd >= 0 ? full.slice(thinkEnd + 8).trim() : full.trim())
  } catch (e) {
    onError(e instanceof Error ? e : new Error(String(e)))
  }
}

// ─── 初次 AI 完整书写方案 ─────────────────────────────────────────
export async function writePlanDetail(
  card: IdeaCard,
  context: { topic: string; keywords: string[]; notes?: string },
  config: LLMConfig,
  onChunk: (text: string) => void,
  onDone: (full: string) => void,
  onError: (err: Error) => void,
): Promise<void> {
  const notesSection = context.notes?.trim()
    ? `\n背景备注：${context.notes.trim()}\n` : ''
  const prompt = `你是专业方案撰写助手。请根据以下信息，撰写一份完整、详细、可执行的方案文档。

主题：${context.topic}
关键词：${context.keywords.join('、')}${notesSection}

方案标题：${card.title}
方案概要：${card.content}
相关关键词：${card.relatedKeywords.join('、')}

要求：
- 用中文撰写，结构清晰，使用 Markdown 格式（标题、列表、分节）
- 包含：背景分析、目标、具体步骤/执行计划、所需资源、注意事项、预期成果
- 内容详实具体，可直接参考执行，篇幅 600-1200 字
- 只输出方案正文，不要任何开场白或结语`

  logger.info(MOD, '开始书写方案详情', { title: card.title })
  await streamRequest(
    config,
    [{ role: 'user', content: prompt }],
    onChunk, onDone, onError,
  )
}

// ─── 对话式修改 ───────────────────────────────────────────────────
export async function chatWithPlan(
  history: ChatMessage[],
  docContent: string,
  config: LLMConfig,
  onChunk: (text: string) => void,
  onDone: (full: string) => void,
  onError: (err: Error) => void,
): Promise<void> {
  const systemPrompt = `你是方案修改助手。当前正在编辑的方案文档如下：

---
${docContent}
---

用户可能要求你：修改某段内容、补充细节、调整结构、重写某节、或回答问题。
- 如果用户要求修改文档，直接输出**完整的修改后文档**（Markdown 格式），不要只输出差异
- 如果用户只是提问或讨论，正常回答即可，不需要输出完整文档
- 输出时不要包含任何前言或"以下是修改后的文档："之类的句子，直接给出内容`

  const messages = [
    { role: 'user', content: systemPrompt },
    { role: 'assistant', content: '好的，我会根据你的要求修改或完善这份方案文档。' },
    ...history.map(m => ({ role: m.role, content: m.content })),
  ]

  logger.info(MOD, '方案对话', { turns: history.length })
  await streamRequest(config, messages, onChunk, onDone, onError)
}

// ─── 关键词诊断分析 ────────────────────────────────────────────────
export interface KeywordAnalysisResult {
  groups: { name: string; keywords: string[]; color: string }[]
  conflicts: { a: string; b: string; reason: string }[]
  duplicates: { words: string[]; suggestion: string }[]
  missing: { dimension: string; examples: string[] }[]
  raw: string   // raw markdown for display
}

const GROUP_PALETTE = [
  '#5b5ef7','#059669','#d97706','#dc2626',
  '#7c3aed','#db2777','#0d9488','#0284c7',
]

export async function analyzeKeywords(
  config: LLMConfig,
  topic: string,
  keywords: string[],
  onChunk: (text: string) => void,
  onDone: (result: KeywordAnalysisResult) => void,
  onError: (err: Error) => void,
): Promise<void> {
  const prompt = `你是头脑风暴关键词诊断专家。主题："${topic}"

当前关键词列表：
${keywords.map((k, i) => `${i + 1}. ${k}`).join('\n')}

请对这些关键词进行全面诊断，只输出如下 JSON，不要任何多余文字或代码块标记：

{
  "groups": [
    { "name": "分组名称", "keywords": ["词1", "词2"] }
  ],
  "conflicts": [
    { "a": "词A", "b": "词B", "reason": "冲突原因简述（20字内）" }
  ],
  "duplicates": [
    { "words": ["词1", "词2"], "suggestion": "建议保留或合并为" }
  ],
  "missing": [
    { "dimension": "缺失维度名", "examples": ["建议词1", "建议词2"] }
  ]
}

要求：
- groups：将关键词按语义归类，每组 2-6 个，组名简洁（4字内），每个词只属于一个组
- conflicts：找出语义矛盾或方向相反的词对，若无则为空数组
- duplicates：找出含义高度相近或重复的词组，若无则为空数组
- missing：当前词列覆盖不足的重要维度，给出 2-4 个建议，每个维度举例 2-3 个词
- 所有词必须来自原始关键词列表（missing.examples 除外，可以是新词）
- 用中文`

  await streamRequest(
    config,
    [{ role: 'user', content: prompt }],
    onChunk,
    (full) => {
      try {
        // Strip think block
        const thinkEnd = full.lastIndexOf('</think>')
        const parseable = thinkEnd >= 0 ? full.slice(thinkEnd + 8).trim() : full.trim()
        // Strip markdown code fences if present
        const json = parseable.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim()
        const parsed = JSON.parse(json)
        const groups = (parsed.groups ?? []).map((g: { name: string; keywords: string[] }, i: number) => ({
          name: g.name,
          keywords: g.keywords ?? [],
          color: GROUP_PALETTE[i % GROUP_PALETTE.length],
        }))
        onDone({
          groups,
          conflicts: parsed.conflicts ?? [],
          duplicates: parsed.duplicates ?? [],
          missing: parsed.missing ?? [],
          raw: full,
        })
      } catch (e) {
        onError(new Error('解析分析结果失败：' + String(e)))
      }
    },
    onError,
  )
}
