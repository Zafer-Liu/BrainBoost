import { useState, useRef, useCallback, useEffect } from 'react'
import { Mic, MicOff, Plus, X, Sparkles, Loader2, NotebookPen, Maximize2, Check, ScanSearch } from 'lucide-react'
import { useSpeechInput } from '../../hooks/useSpeechInput'
import type { AppStore } from '../../store/appStore'
import { KeywordAnalysisModal } from './KeywordAnalysisModal'

interface Props {
  store: AppStore
  onAnalyze: () => void
  // llmConfig passed in from SessionView
  config: import('../../types').LLMConfig
}

/** Vertical drag-divider: returns [topHeight, onMouseDown] */
function useVerticalDivider(initial: number, min: number, max: number) {
  const [height, setHeight] = useState(initial)
  const dragging = useRef(false)
  const startY = useRef(0)
  const startH = useRef(initial)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true
    startY.current = e.clientY
    startH.current = height
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
    e.preventDefault()
  }, [height])

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragging.current) return
      const delta = e.clientY - startY.current
      setHeight(Math.min(max, Math.max(min, startH.current + delta)))
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
  }, [min, max])

  return { height, onMouseDown }
}

export function KeywordPanel({ store, onAnalyze, config }: Props) {
  const [input, setInput] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const { isListening, supported, start, stop } = useSpeechInput({
    onTranscript: (text) => {
      text.split(/[，,、\s]+/).forEach(word => {
        const w = word.trim()
        if (w) store.addKeyword(w)
      })
    },
  })

  function handleAdd() {
    const words = input.split(/[，,、\s]+/)
    words.forEach(w => { if (w.trim()) store.addKeyword(w.trim()) })
    setInput('')
    inputRef.current?.focus()
  }

  const handleNotesChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    store.updateNotes(e.target.value)
  }, [store])

  const keywords = store.currentSession?.keywords ?? []
  const notes = store.currentSession?.notes ?? ''
  const canAnalyze = keywords.length >= 2 && !store.isAnalyzing

  const [showAnalysis, setShowAnalysis] = useState(false)

  // Notes expand modal
  const [notesExpanded, setNotesExpanded] = useState(false)
  const [notesDraft, setNotesDraft] = useState('')
  const expandTextareaRef = useRef<HTMLTextAreaElement>(null)

  function openExpand() {
    setNotesDraft(notes)
    setNotesExpanded(true)
    setTimeout(() => expandTextareaRef.current?.focus(), 50)
  }

  function saveExpand() {
    store.updateNotes(notesDraft)
    setNotesExpanded(false)
  }

  function cancelExpand() {
    setNotesExpanded(false)
  }

  // Vertical divider between keywords list and notes — initial 160px for keywords area
  const divider = useVerticalDivider(160, 60, 360)

  return (
    <div className="keyword-panel">
      <div className="panel-header">
        <h3>关键词</h3>
        <span className="badge">{keywords.length}</span>
        {keywords.length >= 2 && (
          <button
            className="kw-diagnose-btn"
            onClick={() => setShowAnalysis(true)}
            title="诊断关键词：分组、矛盾、重复、缺失"
          >
            <ScanSearch size={13} /> 诊断
          </button>
        )}
      </div>

      <div className="keyword-input-row">
        <input
          ref={inputRef}
          className="keyword-input"
          placeholder="输入关键词，回车添加..."
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
        />
        <button className="icon-btn" onClick={handleAdd} disabled={!input.trim()} title="添加">
          <Plus size={18} />
        </button>
        {supported && (
          <button
            className={`icon-btn ${isListening ? 'active' : ''}`}
            onClick={isListening ? stop : start}
            title={isListening ? '停止录音' : '语音输入'}
          >
            {isListening ? <MicOff size={18} /> : <Mic size={18} />}
          </button>
        )}
      </div>

      {isListening && (
        <div className="listening-indicator">
          <span className="pulse" />
          正在聆听...
        </div>
      )}

      {/* Keywords list — height controlled by divider */}
      <div className="keywords-list" style={{ height: divider.height, maxHeight: 'none', flexShrink: 0 }}>
        {keywords.map(kw => (
          <div key={kw.id} className="keyword-tag">
            <span>{kw.text}</span>
            <button onClick={() => store.removeKeyword(kw.id)}>
              <X size={12} />
            </button>
          </div>
        ))}
        {keywords.length === 0 && (
          <p className="empty-hint">添加关键词后，AI 将自动分析关联</p>
        )}
      </div>

      {/* Draggable divider row */}
      <div className="divider-row" onMouseDown={divider.onMouseDown} title="拖动调整区域大小" />

      {/* Notes section */}
      <div className="notes-section">
        <div className="notes-header">
          <NotebookPen size={13} />
          <span>笔记 Note</span>
          <span className="notes-hint-badge">AI 参考</span>
          <button className="notes-expand-btn" onClick={openExpand} title="展开编辑">
            <Maximize2 size={12} />
          </button>
        </div>
        <textarea
          className="notes-textarea"
          placeholder={"补充背景信息、额外要求或限制条件...\n例如：需要适合10岁以下儿童、预算有限等"}
          value={notes}
          onChange={handleNotesChange}
        />
      </div>

      <button
        className="btn-analyze"
        onClick={onAnalyze}
        disabled={!canAnalyze}
      >
        {store.isAnalyzing ? (
          <><Loader2 size={16} className="spin" /> 分析中...</>
        ) : (
          <><Sparkles size={16} /> AI 分析关联</>
        )}
      </button>

      {keywords.length > 0 && keywords.length < 2 && (
        <p className="hint-text">再添加 {2 - keywords.length} 个关键词即可分析</p>
      )}

      {/* Keyword analysis modal */}
      {showAnalysis && (
        <KeywordAnalysisModal
          store={store}
          config={config}
          onClose={() => setShowAnalysis(false)}
        />
      )}

      {/* Notes expand modal */}
      {notesExpanded && (
        <div className="notes-modal-overlay" onClick={cancelExpand}>
          <div className="notes-modal" onClick={e => e.stopPropagation()}>
            <div className="notes-modal-header">
              <div className="notes-modal-title">
                <NotebookPen size={15} />
                <span>笔记 Note</span>
                <span className="notes-hint-badge">AI 参考</span>
              </div>
              <div className="notes-modal-actions">
                <button className="notes-modal-save" onClick={saveExpand}>
                  <Check size={14} /> 保存
                </button>
                <button className="notes-modal-close" onClick={cancelExpand}>
                  <X size={16} />
                </button>
              </div>
            </div>
            <textarea
              ref={expandTextareaRef}
              className="notes-modal-textarea"
              placeholder={"补充背景信息、额外要求或限制条件...\n例如：需要适合10岁以下儿童、预算有限等"}
              value={notesDraft}
              onChange={e => setNotesDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') cancelExpand()
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) saveExpand()
              }}
            />
            <div className="notes-modal-footer">
              <span>Ctrl+Enter 保存 · Esc 取消</span>
              <span>{notesDraft.length} 字</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
