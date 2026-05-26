import { useState, useCallback, useRef } from 'react'
import { v4 as uuidv4 } from 'uuid'
import type { Session, Keyword, IdeaCard, MindNode, MindEdge, LLMConfig, AppView } from '../types'
import { logger } from '../services/logger'

const MOD = 'AppStore'

const STORAGE_KEY_SESSIONS = 'brainspark_sessions'
const STORAGE_KEY_CONFIG = 'brainspark_llm_config'

function loadSessions(): Session[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SESSIONS)
    const sessions = raw ? JSON.parse(raw) : []
    logger.info(MOD, `从 localStorage 加载会话`, { count: sessions.length })
    return sessions
  } catch (e) {
    logger.error(MOD, '加载会话失败，返回空列表', { error: String(e) })
    return []
  }
}

function saveSessions(sessions: Session[]) {
  localStorage.setItem(STORAGE_KEY_SESSIONS, JSON.stringify(sessions))
  logger.debug(MOD, `会话已持久化`, { count: sessions.length })
}

export function loadLLMConfig(): LLMConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CONFIG)
    return raw ? JSON.parse(raw) : { provider: 'claude', apiKey: '', model: 'claude-sonnet-4-6' }
  } catch {
    return { provider: 'claude', apiKey: '', model: 'claude-sonnet-4-6' }
  }
}

export function saveLLMConfig(config: LLMConfig) {
  localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(config))
}

export function useAppStore() {
  const [view, setView] = useState<AppView>('home')
  const [sessions, setSessions] = useState<Session[]>(loadSessions)
  const [currentSession, setCurrentSession] = useState<Session | null>(null)
  const [llmConfig, setLLMConfigState] = useState<LLMConfig>(loadLLMConfig)
  const [isAnalyzing, setIsAnalyzing] = useState(false)

  // Keep sessions in a ref so callbacks can read latest without stale closure
  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions

  const updateSessions = useCallback((updated: Session[]) => {
    setSessions(updated)
    saveSessions(updated)
  }, [])

  const createSession = useCallback((topic: string): Session => {
    logger.info(MOD, `新建会话`, { topic })
    const session: Session = {
      id: uuidv4(),
      topic,
      keywords: [],
      ideaCards: [],
      mindNodes: [],
      mindEdges: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    setSessions(prev => {
      const updated = [session, ...prev]
      saveSessions(updated)
      return updated
    })
    setCurrentSession(session)
    setView('session')
    logger.debug(MOD, `会话已创建`, { id: session.id })
    return session
  }, [])

  // Safe update: two independent setState calls (no nesting)
  const updateCurrentSession = useCallback((updater: (s: Session) => Session) => {
    setCurrentSession(prev => {
      if (!prev) return prev
      const updated = updater({ ...prev, updatedAt: Date.now() })
      // Schedule sessions update separately (not nested inside updater)
      setSessions(prevSessions => {
        const next = prevSessions.map(s => s.id === updated.id ? updated : s)
        saveSessions(next)
        return next
      })
      return updated
    })
  }, [])

  const addKeyword = useCallback((text: string) => {
    if (!text.trim()) return
    const kw: Keyword = { id: uuidv4(), text: text.trim(), addedAt: Date.now() }
    logger.debug(MOD, `添加关键词`, { text: kw.text, id: kw.id })
    updateCurrentSession(s => ({ ...s, keywords: [...s.keywords, kw] }))
    return kw
  }, [updateCurrentSession])

  const removeKeyword = useCallback((id: string) => {
    logger.debug(MOD, `删除关键词`, { id })
    updateCurrentSession(s => ({ ...s, keywords: s.keywords.filter(k => k.id !== id) }))
  }, [updateCurrentSession])

  const updateMindMap = useCallback((nodes: MindNode[], edges: MindEdge[]) => {
    logger.info(MOD, `更新思维导图`, { nodes: nodes.length, edges: edges.length })
    updateCurrentSession(s => ({ ...s, mindNodes: nodes, mindEdges: edges }))
  }, [updateCurrentSession])

  const updateIdeaCards = useCallback((cards: IdeaCard[]) => {
    logger.info(MOD, `更新方案卡片`, { count: cards.length })
    updateCurrentSession(s => ({ ...s, ideaCards: cards }))
  }, [updateCurrentSession])

  // ── Notes ─────────────────────────────────────────────────────────────────
  const updateNotes = useCallback((notes: string) => {
    updateCurrentSession(s => ({ ...s, notes }))
  }, [updateCurrentSession])

  // ── IdeaCard edits ─────────────────────────────────────────────────────────
  const updateIdeaCard = useCallback((id: string, patch: Partial<IdeaCard>) => {
    updateCurrentSession(s => ({
      ...s,
      ideaCards: s.ideaCards.map(c => c.id === id ? { ...c, ...patch, editedAt: Date.now() } : c),
    }))
  }, [updateCurrentSession])

  const deleteIdeaCard = useCallback((id: string) => {
    updateCurrentSession(s => ({ ...s, ideaCards: s.ideaCards.filter(c => c.id !== id) }))
  }, [updateCurrentSession])

  const addIdeaCard = useCallback((card: IdeaCard) => {
    updateCurrentSession(s => ({ ...s, ideaCards: [...s.ideaCards, card] }))
  }, [updateCurrentSession])

  // ── MindMap node/edge edits ────────────────────────────────────────────────
  const toggleNodeLock = useCallback((id: string) => {
    updateCurrentSession(s => ({
      ...s,
      mindNodes: s.mindNodes.map(n => n.id === id ? { ...n, locked: !n.locked } : n),
    }))
  }, [updateCurrentSession])

  const toggleCardLock = useCallback((id: string) => {
    updateCurrentSession(s => ({
      ...s,
      ideaCards: s.ideaCards.map(c => c.id === id ? { ...c, locked: !c.locked } : c),
    }))
  }, [updateCurrentSession])

  const updateMindNode = useCallback((id: string, patch: Partial<MindNode>) => {
    updateCurrentSession(s => ({
      ...s,
      mindNodes: s.mindNodes.map(n => n.id === id ? { ...n, ...patch } : n),
    }))
  }, [updateCurrentSession])

  const deleteMindNode = useCallback((id: string) => {
    updateCurrentSession(s => ({
      ...s,
      mindNodes: s.mindNodes.filter(n => n.id !== id),
      mindEdges: s.mindEdges.filter(e => e.source !== id && e.target !== id),
    }))
  }, [updateCurrentSession])

  const addMindNode = useCallback((node: MindNode) => {
    updateCurrentSession(s => ({ ...s, mindNodes: [...s.mindNodes, node] }))
  }, [updateCurrentSession])

  const updateMindEdge = useCallback((idx: number, patch: Partial<MindEdge>) => {
    updateCurrentSession(s => ({
      ...s,
      mindEdges: s.mindEdges.map((e, i) => i === idx ? { ...e, ...patch } : e),
    }))
  }, [updateCurrentSession])

  const deleteMindEdge = useCallback((idx: number) => {
    updateCurrentSession(s => ({
      ...s,
      mindEdges: s.mindEdges.filter((_, i) => i !== idx),
    }))
  }, [updateCurrentSession])

  const addMindEdge = useCallback((edge: MindEdge) => {
    updateCurrentSession(s => ({ ...s, mindEdges: [...s.mindEdges, edge] }))
  }, [updateCurrentSession])

  const openSession = useCallback((session: Session) => {
    logger.info(MOD, `打开会话`, { id: session.id, topic: session.topic })
    setCurrentSession(session)
    setView('session')
  }, [])

  const deleteSession = useCallback((id: string) => {
    logger.info(MOD, `删除会话`, { id })
    setSessions(prev => {
      const updated = prev.filter(s => s.id !== id)
      saveSessions(updated)
      return updated
    })
    setCurrentSession(prev => {
      if (prev?.id === id) {
        setView('home')
        return null
      }
      return prev
    })
  }, [])

  const setLLMConfig = useCallback((config: LLMConfig) => {
    logger.info(MOD, `保存 LLM 配置`, { provider: config.provider, model: config.model, hasKey: !!config.apiKey })
    setLLMConfigState(config)
    saveLLMConfig(config)
  }, [])

  return {
    view, setView,
    sessions,
    currentSession,
    llmConfig,
    isAnalyzing, setIsAnalyzing,
    createSession,
    updateCurrentSession,
    addKeyword,
    removeKeyword,
    updateNotes,
    updateMindMap,
    updateIdeaCards,
    updateIdeaCard,
    deleteIdeaCard,
    addIdeaCard,
    toggleNodeLock,
    toggleCardLock,
    updateMindNode,
    deleteMindNode,
    addMindNode,
    updateMindEdge,
    deleteMindEdge,
    addMindEdge,
    openSession,
    deleteSession,
    setLLMConfig,
  }
}

export type AppStore = ReturnType<typeof useAppStore>
