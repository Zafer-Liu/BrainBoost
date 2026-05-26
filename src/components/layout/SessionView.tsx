import { useState, useRef, useCallback, useEffect } from 'react'
import { ArrowLeft, Download, FileText, FileImage, Settings, AlertCircle } from 'lucide-react'
import { KeywordPanel } from '../keywords/KeywordPanel'
import { MindMapView } from '../mindmap/MindMapView'
import { IdeaCardsPanel } from '../ideas/IdeaCardsPanel'
import { analyzeKeywordsStream } from '../../services/llmService'
import type { LockedContext } from '../../services/llmService'
import { exportMarkdown, exportDocx, exportMindMapImage } from '../../services/exportService'
import { logger } from '../../services/logger'
import type { IdeaCard, MindEdge, MindNode } from '../../types'
import type { AppStore } from '../../store/appStore'

const MOD = 'SessionView'

interface Props {
  store: AppStore
}

function useDivider(initial: number, min: number, max: number, invert = false) {
  const [size, setSize] = useState(initial)
  const dragging = useRef(false)
  const startX = useRef(0)
  const startSize = useRef(initial)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true
    startX.current = e.clientX
    startSize.current = size
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    e.preventDefault()
  }, [size])

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragging.current) return
      const delta = e.clientX - startX.current
      const applied = invert ? -delta : delta
      setSize(Math.min(max, Math.max(min, startSize.current + applied)))
    }
    function onUp() {
      if (!dragging.current) return
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [min, max, invert])

  return { size, onMouseDown }
}

export function SessionView({ store }: Props) {
  const [error, setError] = useState<string | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [streamingCards, setStreamingCards] = useState<IdeaCard[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [highlightNodeIds, setHighlightNodeIds] = useState<string[]>([])

  const left = useDivider(280, 180, 480)
  const right = useDivider(300, 200, 520, true)

  const updateMindMapRef = useRef(store.updateMindMap)
  const setIsAnalyzingRef = useRef(store.setIsAnalyzing)
  updateMindMapRef.current = store.updateMindMap
  setIsAnalyzingRef.current = store.setIsAnalyzing

  const session = store.currentSession
  if (!session) return null

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleAnalyze = useCallback(async () => {
    if (!store.currentSession) return
    if (!store.llmConfig.apiKey) {
      logger.warn(MOD, '未配置 API Key')
      setError('请先在「设置」中填写 API Key')
      return
    }

    const { topic, keywords, notes, mindNodes, ideaCards } = store.currentSession

    // Collect locked nodes and cards
    const locked: LockedContext = {
      nodes: mindNodes.filter(n => n.locked),
      cards: ideaCards.filter(c => c.locked),
    }
    const hasLocked = locked.nodes.length > 0 || locked.cards.length > 0

    logger.info(MOD, '触发流式分析', { topic, count: keywords.length, hasNotes: !!notes?.trim(), lockedNodes: locked.nodes.length, lockedCards: locked.cards.length })

    setIsAnalyzingRef.current(true)
    setIsStreaming(true)
    setStreamingCards([])
    setError(null)

    analyzeKeywordsStream(
      store.llmConfig,
      topic,
      keywords.map(k => k.text),
      {
        onMindMap: (nodes: MindNode[], edges: MindEdge[]) => {
          logger.info(MOD, '流式：思维导图就绪', { nodes: nodes.length, edges: edges.length })
          updateMindMapRef.current(nodes, edges)
        },
        onIdeaCard: (card: IdeaCard) => {
          logger.info(MOD, '流式：新卡片', { title: card.title })
          setStreamingCards(prev => [...prev, card])
        },
        onDone: (result) => {
          logger.info(MOD, '流式完成', { nodes: result.nodes.length, ideaCards: result.ideaCards.length })
          store.updateCurrentSession(s => ({
            ...s,
            mindNodes: result.nodes,
            mindEdges: result.edges,
            ideaCards: result.ideaCards,
          }))
          setStreamingCards([])
          setIsStreaming(false)
          setIsAnalyzingRef.current(false)
        },
        onError: (e) => {
          logger.error(MOD, '流式出错', { error: e.message })
          setError(e.message)
          setStreamingCards([])
          setIsStreaming(false)
          setIsAnalyzingRef.current(false)
        },
      },
      notes,
      hasLocked ? locked : undefined,
    )
  }, [store.llmConfig, store.currentSession])

  async function handleExport(type: 'md' | 'docx' | 'png') {
    if (!session) return
    setExportOpen(false)
    logger.info(MOD, '触发导出', { type })
    try {
      if (type === 'md') await exportMarkdown(session)
      else if (type === 'docx') await exportDocx(session)
      else await exportMindMapImage('mindmap-canvas', session.topic)
    } catch (e) {
      logger.error(MOD, '导出失败', { type, error: String(e) })
      setError(e instanceof Error ? e.message : '导出失败')
    }
  }

  const displayCards = isStreaming ? streamingCards : session.ideaCards

  return (
    <div className="session-view">
      <header className="session-header">
        <button className="icon-btn" onClick={() => store.setView('home')}>
          <ArrowLeft size={20} />
        </button>
        <h2 className="session-title">{session.topic}</h2>
        <div className="header-actions">
          <div className="export-dropdown">
            <button className="btn-secondary" onClick={() => setExportOpen(o => !o)}>
              <Download size={16} /> 导出
            </button>
            {exportOpen && (
              <div className="dropdown-menu">
                <button onClick={() => handleExport('md')}>
                  <FileText size={14} /> Markdown (.md)
                </button>
                <button onClick={() => handleExport('docx')}>
                  <FileText size={14} /> Word (.docx)
                </button>
                <button onClick={() => handleExport('png')}>
                  <FileImage size={14} /> 思维导图图片
                </button>
              </div>
            )}
          </div>
          <button className="icon-btn" onClick={() => store.setView('settings')} title="设置">
            <Settings size={18} />
          </button>
        </div>
      </header>

      {error && (
        <div className="error-banner">
          <AlertCircle size={16} />
          {error}
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}

      <div
        className="session-body"
        style={{ gridTemplateColumns: `${left.size}px 4px 1fr 4px ${right.size}px` }}
      >
        <aside className="session-sidebar">
          <KeywordPanel store={store} onAnalyze={handleAnalyze} config={store.llmConfig} />
        </aside>

        <div className="divider-col" onMouseDown={left.onMouseDown} />

        <div className="session-canvas">
          <MindMapView
            store={store}
            nodes={session.mindNodes}
            edges={session.mindEdges}
            topic={session.topic}
            streaming={isStreaming && session.mindNodes.length === 0}
            highlightNodeIds={highlightNodeIds}
          />
        </div>

        <div className="divider-col" onMouseDown={right.onMouseDown} />

        <aside className="session-ideas">
          <IdeaCardsPanel
            store={store}
            cards={displayCards}
            streaming={isStreaming}
            onHighlightNodes={setHighlightNodeIds}
          />
        </aside>
      </div>
    </div>
  )
}
