import type { LLMConfig, MindNode, MindEdge, IdeaCard, ChatMessage, LockedContext } from '../types'
import { v4 as uuidv4 } from 'uuid'
import { logger } from './logger'
import {
  buildAnalyzePrompt,
  buildWritePlanPrompt,
  buildChatSystemPrompt,
  buildKeywordAnalysisPrompt,
} from './prompts'
import {
  tryExtractMindMap,
  extractNewCards,
  stripThinkBlocks,
  parseKeywordAnalysis,
  extractArray,
  extractObjects,
} from './jsonParser'
import { streamRequest, readStream, buildStreamRequest } from './stream'

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

// ─── Main entry: streamed keyword analysis ────────────────────────

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

  logger.info(MOD, '开始流式分析', {
    topic,
    count: keywords.length,
    hasNotes: !!notes?.trim(),
    lockedNodes: locked?.nodes.length ?? 0,
    lockedCards: locked?.cards.length ?? 0,
  })
  const prompt = buildAnalyzePrompt(topic, keywords, notes, locked)
  const t0 = Date.now()

  let mindMapSent = false
  let knownCardCount = 0
  let streamedNodes: MindNode[] = []
  let streamedEdges: MindEdge[] = []
  let streamedCards: IdeaCard[] = []

  const onChunk = (partial: string) => {
    // Strip ALL <think> blocks (including streaming-unclosed ones) before parsing.
    // The model may quote the prompt's JSON template inside its reasoning.
    const parseable = stripThinkBlocks(partial)

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
    const { resp: respPromise } = buildStreamRequest(config, [{ role: 'user', content: prompt }], 100000)
    const resp = await respPromise

    logger.debug(MOD, `HTTP ${resp.status} ${resp.statusText}`)

    if (!resp.ok) {
      const err = await resp.text()
      logger.error(MOD, 'API 失败', { status: resp.status, body: err })
      callbacks.onError(new Error(`API 错误 ${resp.status}: ${err}`))
      return
    }

    const full = await readStream(resp, config.provider, onChunk)
    logger.info(MOD, `流式完成，耗时 ${Date.now() - t0}ms`, { chars: full.length })

    const parseable = stripThinkBlocks(full)

    // Fallback full parse for nodes (if streaming missed them)
    if (streamedNodes.length === 0) {
      logger.warn(MOD, '流式未能提取思维导图，尝试全量解析')
      const nodesStr = extractArray(parseable, 'nodes')
      if (nodesStr) {
        streamedNodes = extractObjects(nodesStr).map(n => ({
          id: (n.id as string) || uuidv4(),
          label: (n.label as string) || '',
          group: n.group as string | undefined,
          keywords: (n.keywords as string[]) || [],
        }))
      }
    }
    // Always attempt fallback for edges — streaming often captures nodes before edges arrive
    if (streamedEdges.length === 0) {
      const edgesStr = extractArray(parseable, 'edges')
      if (edgesStr) {
        const parsed = extractObjects(edgesStr).map(e => ({
          source: (e.source as string) || '',
          target: (e.target as string) || '',
          label: e.label as string | undefined,
        }))
        if (parsed.length > 0) {
          logger.info(MOD, `全量解析补充 edges`, { count: parsed.length })
          streamedEdges = parsed
        }
      }
    }
    if (streamedCards.length === 0) {
      logger.warn(MOD, '流式未能提取方案卡片，尝试全量解析')
      const cardsStr = extractArray(parseable, 'ideaCards')
      if (cardsStr) {
        streamedCards = extractObjects(cardsStr).map(c => ({
          id: uuidv4(),
          title: (c.title as string) || '',
          content: (c.content as string) || '',
          relatedKeywords: (c.relatedKeywords as string[]) || [],
          relatedNodeIds: (c.relatedNodeIds as string[]) || [],
          createdAt: Date.now(),
        }))
      }
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

    logger.info(MOD, '最终结果', {
      nodes: streamedNodes.length,
      edges: streamedEdges.length,
      ideaCards: streamedCards.length,
    })
    callbacks.onDone({ nodes: streamedNodes, edges: streamedEdges, ideaCards: streamedCards })
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e))
    logger.error(MOD, '流式分析失败', { error: err.message })
    callbacks.onError(err)
  }
}

// ─── Write full plan from a card ──────────────────────────────────

export async function writePlanDetail(
  card: IdeaCard,
  context: { topic: string; keywords: string[]; notes?: string },
  config: LLMConfig,
  onChunk: (text: string) => void,
  onDone: (full: string) => void,
  onError: (err: Error) => void,
): Promise<void> {
  const prompt = buildWritePlanPrompt(card, context)
  logger.info(MOD, '开始书写方案详情', { title: card.title })
  await streamRequest(
    config,
    [{ role: 'user', content: prompt }],
    onChunk, onDone, onError,
  )
}

// ─── Chat with plan document ──────────────────────────────────────

export async function chatWithPlan(
  history: ChatMessage[],
  docContent: string,
  config: LLMConfig,
  onChunk: (text: string) => void,
  onDone: (full: string) => void,
  onError: (err: Error) => void,
): Promise<void> {
  const systemPrompt = buildChatSystemPrompt(docContent)

  const messages = [
    { role: 'user', content: systemPrompt },
    { role: 'assistant', content: '好的，我会根据你的要求修改或完善这份方案文档。' },
    ...history.map(m => ({ role: m.role, content: m.content })),
  ]

  logger.info(MOD, '方案对话', { turns: history.length })
  await streamRequest(config, messages, onChunk, onDone, onError)
}

// ─── Keyword diagnosis analysis ───────────────────────────────────

export interface KeywordAnalysisResult {
  groups: { name: string; keywords: string[]; color: string }[]
  conflicts: { a: string; b: string; reason: string }[]
  duplicates: { words: string[]; suggestion: string }[]
  missing: { dimension: string; examples: string[] }[]
  raw: string
}

const GROUP_PALETTE = [
  '#5b5ef7', '#059669', '#d97706', '#dc2626',
  '#7c3aed', '#db2777', '#0d9488', '#0284c7',
]

export async function analyzeKeywords(
  config: LLMConfig,
  topic: string,
  keywords: string[],
  onChunk: (text: string) => void,
  onDone: (result: KeywordAnalysisResult) => void,
  onError: (err: Error) => void,
): Promise<void> {
  const prompt = buildKeywordAnalysisPrompt(topic, keywords)

  await streamRequest(
    config,
    [{ role: 'user', content: prompt }],
    onChunk,
    (full) => {
      try {
        const parsed = parseKeywordAnalysis(full) as {
          groups?: { name: string; keywords: string[] }[]
          conflicts?: { a: string; b: string; reason: string }[]
          duplicates?: { words: string[]; suggestion: string }[]
          missing?: { dimension: string; examples: string[] }[]
        }
        const groups = (parsed.groups ?? []).map((g, i) => ({
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
