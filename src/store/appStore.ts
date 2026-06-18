import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import type { Session, Keyword, IdeaCard, MindNode, MindEdge, LLMConfig, AppView } from '../types'
import { logger } from '../services/logger'
import {
  safeSetJSON,
  safeGetJSON,
  safeGetObfuscated,
  safeSetObfuscated,
  type SafeStorageResult,
} from '../services/safeStorage'

const MOD = 'AppStore'

const STORAGE_KEY_SESSIONS = 'brainspark_sessions'
const STORAGE_KEY_CONFIG = 'brainspark_llm_config'
const STORAGE_KEY_APIKEY = 'brainspark_llm_apikey'

// ─── Persistence helpers ──────────────────────────────────────────

function loadSessions(): Session[] {
  const sessions = safeGetJSON<Session[]>(STORAGE_KEY_SESSIONS, [])
  logger.info(MOD, `从 localStorage 加载会话`, { count: sessions.length })
  return sessions
}

function saveSessions(sessions: Session[]): SafeStorageResult {
  return safeSetJSON(STORAGE_KEY_SESSIONS, sessions)
}

/**
 * Load LLM config. API Key is stored separately in obfuscated form;
 * config.apiKey in storage is left blank to avoid plaintext duplication.
 */
export function loadLLMConfig(): LLMConfig {
  const stored = safeGetJSON<Partial<LLMConfig>>(STORAGE_KEY_CONFIG, {})
  const apiKey = safeGetObfuscated(STORAGE_KEY_APIKEY, '')
  return {
    provider: stored.provider ?? 'claude',
    apiKey,
    model: stored.model ?? 'claude-sonnet-4-6',
    baseURL: stored.baseURL,
    claudeBaseURL: stored.claudeBaseURL,
    disableThinking: stored.disableThinking,
  }
}

export function saveLLMConfig(config: LLMConfig): { ok: boolean; error?: string } {
  // Persist config without apiKey (kept separately, obfuscated)
  const { apiKey, ...rest } = config
  const r1 = safeSetJSON(STORAGE_KEY_CONFIG, rest)
  safeSetObfuscated(STORAGE_KEY_APIKEY, apiKey)
  return r1.ok ? { ok: true } : r1
}

// ─── Store ────────────────────────────────────────────────────────

export interface AppState {
  // State
  view: AppView
  sessions: Session[]
  currentSession: Session | null
  llmConfig: LLMConfig
  isAnalyzing: boolean

  // View
  setView: (v: AppView) => void

  // Session lifecycle
  createSession: (topic: string) => Session
  openSession: (session: Session) => void
  deleteSession: (id: string) => void
  updateCurrentSession: (updater: (s: Session) => Session) => void

  // Keyword CRUD
  addKeyword: (text: string) => Keyword | undefined
  removeKeyword: (id: string) => void
  updateNotes: (notes: string) => void

  // Mind map + idea cards bulk
  updateMindMap: (nodes: MindNode[], edges: MindEdge[]) => void
  updateIdeaCards: (cards: IdeaCard[]) => void

  // IdeaCard CRUD
  updateIdeaCard: (id: string, patch: Partial<IdeaCard>) => void
  deleteIdeaCard: (id: string) => void
  addIdeaCard: (card: IdeaCard) => void

  // MindNode / MindEdge CRUD
  toggleNodeLock: (id: string) => void
  toggleCardLock: (id: string) => void
  updateMindNode: (id: string, patch: Partial<MindNode>) => void
  deleteMindNode: (id: string) => void
  addMindNode: (node: MindNode) => void
  updateMindEdge: (idx: number, patch: Partial<MindEdge>) => void
  deleteMindEdge: (idx: number) => void
  addMindEdge: (edge: MindEdge) => void

  // LLM config
  setLLMConfig: (config: LLMConfig) => void
  setIsAnalyzing: (v: boolean) => void
}

export const useAppStore = create<AppState>()((set) => {
  /** Update currentSession AND mirror it into sessions[] + localStorage. Single source of truth. */
  const patchCurrentSession = (updater: (s: Session) => Session) => {
    set(state => {
      if (!state.currentSession) return state
      const updated = updater({ ...state.currentSession, updatedAt: Date.now() })
      const sessions = state.sessions.map(s => s.id === updated.id ? updated : s)
      const r = saveSessions(sessions)
      if (!r.ok) {
        logger.warn(MOD, '会话持久化失败（配额满），仅保留内存副本', { error: r.error })
      }
      return { currentSession: updated, sessions }
    })
  }

  return {
    view: 'home',
    sessions: loadSessions(),
    currentSession: null,
    llmConfig: loadLLMConfig(),
    isAnalyzing: false,

    setView: (v) => set({ view: v }),

    createSession: (topic) => {
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
      set(state => {
        const sessions = [session, ...state.sessions]
        const r = saveSessions(sessions)
        if (!r.ok) logger.warn(MOD, '新建会话持久化失败', { error: r.error })
        return { sessions, currentSession: session, view: 'session' as AppView }
      })
      logger.debug(MOD, `会话已创建`, { id: session.id })
      return session
    },

    openSession: (session) => {
      logger.info(MOD, `打开会话`, { id: session.id, topic: session.topic })
      set({ currentSession: session, view: 'session' })
    },

    deleteSession: (id) => {
      logger.info(MOD, `删除会话`, { id })
      set(state => {
        const sessions = state.sessions.filter(s => s.id !== id)
        const r = saveSessions(sessions)
        if (!r.ok) logger.warn(MOD, '删除会话后持久化失败', { error: r.error })
        const currentSession = state.currentSession?.id === id ? null : state.currentSession
        const view: AppView = state.currentSession?.id === id ? 'home' : state.view
        return { sessions, currentSession, view }
      })
    },

    updateCurrentSession: patchCurrentSession,

    addKeyword: (text) => {
      if (!text.trim()) return
      const kw: Keyword = { id: uuidv4(), text: text.trim(), addedAt: Date.now() }
      logger.debug(MOD, `添加关键词`, { text: kw.text, id: kw.id })
      patchCurrentSession(s => ({ ...s, keywords: [...s.keywords, kw] }))
      return kw
    },

    removeKeyword: (id) => {
      logger.debug(MOD, `删除关键词`, { id })
      patchCurrentSession(s => ({ ...s, keywords: s.keywords.filter(k => k.id !== id) }))
    },

    updateNotes: (notes) => {
      patchCurrentSession(s => ({ ...s, notes }))
    },

    updateMindMap: (nodes, edges) => {
      logger.info(MOD, `更新思维导图`, { nodes: nodes.length, edges: edges.length })
      patchCurrentSession(s => ({ ...s, mindNodes: nodes, mindEdges: edges }))
    },

    updateIdeaCards: (cards) => {
      logger.info(MOD, `更新方案卡片`, { count: cards.length })
      patchCurrentSession(s => ({ ...s, ideaCards: cards }))
    },

    updateIdeaCard: (id, patch) => {
      patchCurrentSession(s => ({
        ...s,
        ideaCards: s.ideaCards.map(c => c.id === id ? { ...c, ...patch, editedAt: Date.now() } : c),
      }))
    },

    deleteIdeaCard: (id) => {
      patchCurrentSession(s => ({ ...s, ideaCards: s.ideaCards.filter(c => c.id !== id) }))
    },

    addIdeaCard: (card) => {
      patchCurrentSession(s => ({ ...s, ideaCards: [...s.ideaCards, card] }))
    },

    toggleNodeLock: (id) => {
      patchCurrentSession(s => ({
        ...s,
        mindNodes: s.mindNodes.map(n => n.id === id ? { ...n, locked: !n.locked } : n),
      }))
    },

    toggleCardLock: (id) => {
      patchCurrentSession(s => ({
        ...s,
        ideaCards: s.ideaCards.map(c => c.id === id ? { ...c, locked: !c.locked } : c),
      }))
    },

    updateMindNode: (id, patch) => {
      patchCurrentSession(s => ({
        ...s,
        mindNodes: s.mindNodes.map(n => n.id === id ? { ...n, ...patch } : n),
      }))
    },

    deleteMindNode: (id) => {
      patchCurrentSession(s => ({
        ...s,
        mindNodes: s.mindNodes.filter(n => n.id !== id),
        mindEdges: s.mindEdges.filter(e => e.source !== id && e.target !== id),
      }))
    },

    addMindNode: (node) => {
      patchCurrentSession(s => ({ ...s, mindNodes: [...s.mindNodes, node] }))
    },

    updateMindEdge: (idx, patch) => {
      patchCurrentSession(s => ({
        ...s,
        mindEdges: s.mindEdges.map((e, i) => i === idx ? { ...e, ...patch } : e),
      }))
    },

    deleteMindEdge: (idx) => {
      patchCurrentSession(s => ({
        ...s,
        mindEdges: s.mindEdges.filter((_, i) => i !== idx),
      }))
    },

    addMindEdge: (edge) => {
      patchCurrentSession(s => ({ ...s, mindEdges: [...s.mindEdges, edge] }))
    },

    setLLMConfig: (config) => {
      logger.info(MOD, `保存 LLM 配置`, {
        provider: config.provider,
        model: config.model,
        hasKey: !!config.apiKey,
        hasClaudeBaseURL: !!config.claudeBaseURL,
      })
      const r = saveLLMConfig(config)
      if (!r.ok) logger.warn(MOD, 'LLM 配置持久化失败', { error: r.error })
      set({ llmConfig: config })
    },

    setIsAnalyzing: (v) => set({ isAnalyzing: v }),
  }
})

// Backward-compat: many components expect `useAppStore()` to return an object
// with all state + methods. Zustand's `useAppStore()` (no selector) does exactly that.
// Components using `store.xxx` props-drilling continue to work unchanged.

// Components receive the full state object via props; AppState is the exact shape.
export type AppStore = AppState
