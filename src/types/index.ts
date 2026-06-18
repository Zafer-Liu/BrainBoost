export interface Keyword {
  id: string
  text: string
  addedAt: number
}

export interface MindNode {
  id: string
  label: string
  group?: string
  keywords: string[]
  locked?: boolean
}

export interface MindEdge {
  source: string
  target: string
  label?: string
}

export interface IdeaCard {
  id: string
  title: string
  content: string
  relatedKeywords: string[]
  relatedNodeIds: string[]   // node IDs from the mind map this card references
  createdAt: number
  editedAt?: number
  locked?: boolean
}

export interface Session {
  id: string
  topic: string
  keywords: Keyword[]
  notes?: string             // background notes sent to LLM
  ideaCards: IdeaCard[]
  mindNodes: MindNode[]
  mindEdges: MindEdge[]
  createdAt: number
  updatedAt: number
}

export interface LLMConfig {
  provider: 'claude' | 'openai' | 'custom'
  apiKey: string
  model: string
  baseURL?: string              // OpenAI-compatible base URL
  claudeBaseURL?: string        // Anthropic API base URL (proxy / private deployment)
  disableThinking?: boolean
}

export type AppView = 'home' | 'session' | 'settings'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  id: string
  createdAt: number
}

/** Locked nodes + cards that must be preserved across LLM re-analysis. */
export interface LockedContext {
  nodes: MindNode[]
  cards: IdeaCard[]
}
