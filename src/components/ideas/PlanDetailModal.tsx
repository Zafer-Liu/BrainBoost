import { useState, useRef, useEffect, useCallback } from 'react'
import { v4 as uuidv4 } from 'uuid'
import {
  X, Sparkles, Send, Loader2, RotateCcw,
  Copy, Check, PenLine, MessageSquare, Maximize2, Minimize2,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'
import type { IdeaCard, ChatMessage, LLMConfig } from '../../types'
import { writePlanDetail, chatWithPlan } from '../../services/llmService'

interface Props {
  card: IdeaCard
  context: { topic: string; keywords: string[]; notes?: string }
  config: LLMConfig
  onClose: () => void
  /** Persisted state for this card — undefined means first open */
  initialDoc?: string
  initialChat?: ChatMessage[]
  /** Called whenever doc or chat changes so parent can persist */
  onSave?: (cardId: string, doc: string, chat: ChatMessage[]) => void
}

// ── Markdown renderer (XSS-safe via rehype-sanitize) ──────────────
// Replaces the hand-rolled renderMd + dangerouslySetInnerHTML approach.
// LLM output is untrusted content; this prevents <script>, onerror=, javascript: URLs etc.

function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeSanitize]}
      components={{
        table: ({ node, ...props }) => <table className="plan-md-table" {...props} />,
      }}
    >
      {children}
    </ReactMarkdown>
  )
}

// ── Resize hook ───────────────────────────────────────────────────
function useResize(initialW: number, initialH: number) {
  const [size, setSize] = useState({ w: initialW, h: initialH })
  const dragging = useRef<{ edge: string; startX: number; startY: number; startW: number; startH: number } | null>(null)

  const onMouseDown = useCallback((edge: string) => (e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = { edge, startX: e.clientX, startY: e.clientY, startW: size.w, startH: size.h }

    function onMove(ev: MouseEvent) {
      if (!dragging.current) return
      const { edge, startX, startY, startW, startH } = dragging.current
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      setSize(prev => {
        const newW = edge.includes('e') ? Math.max(600, startW + dx)
          : edge.includes('w') ? Math.max(600, startW - dx)
          : prev.w
        const newH = edge.includes('s') ? Math.max(400, startH + dy)
          : edge.includes('n') ? Math.max(400, startH - dy)
          : prev.h
        return { w: newW, h: newH }
      })
    }

    function onUp() {
      dragging.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [size])

  return { size, onMouseDown }
}

export function PlanDetailModal({
  card, context, config, onClose,
  initialDoc = '', initialChat = [],
  onSave,
}: Props) {
  const [docContent, setDocContent] = useState(initialDoc)
  const [isEditing, setIsEditing] = useState(false)
  const [editDraft, setEditDraft] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [streamBuffer, setStreamBuffer] = useState('')
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(initialChat)
  const [chatInput, setChatInput] = useState('')
  const [isChatting, setIsChatting] = useState(false)
  const [copied, setCopied] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)

  const { size, onMouseDown } = useResize(
    Math.min(1100, window.innerWidth - 48),
    Math.min(window.innerHeight * 0.9, window.innerHeight - 48)
  )

  const chatEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<boolean>(false)
  const mainScrollRef = useRef<HTMLDivElement>(null)

  // Persist whenever doc or chat changes
  useEffect(() => {
    if (onSave) onSave(card.id, docContent, chatMessages)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docContent, chatMessages])

  // Auto-scroll to bottom of chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages, isChatting])

  // Auto-generate on first open only if doc is empty
  useEffect(() => {
    if (!initialDoc && !isGenerating) {
      handleGenerate()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleGenerate = useCallback(async () => {
    if (isGenerating) return
    abortRef.current = false
    setIsGenerating(true)
    setIsEditing(false)
    setStreamBuffer('')
    setDocContent('')

    let acc = ''
    await writePlanDetail(
      card, context, config,
      (partial) => {
        if (abortRef.current) return
        const thinkEnd = partial.lastIndexOf('</think>')
        const visible = thinkEnd >= 0 ? partial.slice(thinkEnd + 8) : partial
        acc = visible
        setStreamBuffer(visible)
      },
      (full) => {
        if (abortRef.current) return
        const finalDoc = full || acc
        setDocContent(finalDoc)
        setStreamBuffer('')
        setIsGenerating(false)
        if (onSave) onSave(card.id, finalDoc, chatMessages)
      },
      (err) => {
        setStreamBuffer(`生成失败：${err.message}`)
        setIsGenerating(false)
      },
    )
  }, [card, context, config, isGenerating, chatMessages, onSave])

  function startEdit() {
    setEditDraft(docContent)
    setIsEditing(true)
    setTimeout(() => textareaRef.current?.focus(), 50)
  }

  function cancelEdit() {
    setIsEditing(false)
    setEditDraft('')
  }

  function saveEdit() {
    setDocContent(editDraft)
    setIsEditing(false)
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(docContent)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  async function handleChat() {
    const text = chatInput.trim()
    if (!text || isChatting) return

    const userMsg: ChatMessage = { id: uuidv4(), role: 'user', content: text, createdAt: Date.now() }
    setChatMessages(prev => [...prev, userMsg])
    setChatInput('')
    setIsChatting(true)

    const assistantId = uuidv4()
    let acc = ''
    setChatMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '', createdAt: Date.now() }])

    await chatWithPlan(
      [...chatMessages, userMsg],
      docContent,
      config,
      (partial) => {
        const thinkEnd = partial.lastIndexOf('</think>')
        acc = thinkEnd >= 0 ? partial.slice(thinkEnd + 8) : partial
        setChatMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: acc } : m))
      },
      (full) => {
        const finalText = full || acc
        setChatMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: finalText } : m))
        setIsChatting(false)
      },
      (err) => {
        setChatMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: `出错：${err.message}` } : m))
        setIsChatting(false)
      },
    )
  }

  function applyToDoc(content: string) {
    setDocContent(content)
    // Scroll back to top
    if (mainScrollRef.current) mainScrollRef.current.scrollTop = 0
  }

  function toggleFullscreen() {
    setFullscreen(f => !f)
    setMinimized(false)
  }

  const displayContent = isGenerating ? streamBuffer : docContent

  return (
    <div className={`plan-modal-overlay${fullscreen ? ' plan-modal-overlay--fullscreen' : ''}`}>
      <div
        className={`plan-modal${minimized ? ' plan-modal--minimized' : ''}${fullscreen ? ' plan-modal--fullscreen' : ''}`}
        style={minimized || fullscreen ? {} : { width: size.w, height: size.h, maxWidth: '100vw', maxHeight: '100vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Resize handles — only when not minimized */}
        {!minimized && (
          <>
            <div className="plan-resize-handle plan-resize-e" onMouseDown={onMouseDown('e')} />
            <div className="plan-resize-handle plan-resize-w" onMouseDown={onMouseDown('w')} />
            <div className="plan-resize-handle plan-resize-s" onMouseDown={onMouseDown('s')} />
            <div className="plan-resize-handle plan-resize-se" onMouseDown={onMouseDown('se')} />
            <div className="plan-resize-handle plan-resize-sw" onMouseDown={onMouseDown('sw')} />
          </>
        )}

        {/* ── Header ── */}
        <div className="plan-modal-header">
          <div className="plan-modal-title">
            <PenLine size={16} />
            <span>{card.title}</span>
          </div>
          <div className="plan-modal-actions">
            {!minimized && (
              <>
                <button
                  className="plan-action-btn"
                  onClick={handleGenerate}
                  disabled={isGenerating}
                  title="重新 AI 生成"
                >
                  {isGenerating
                    ? <><Loader2 size={14} className="spin" /> 生成中...</>
                    : <><RotateCcw size={14} /> 重新生成</>
                  }
                </button>
                <button
                  className="plan-action-btn"
                  onClick={handleCopy}
                  disabled={!docContent}
                  title="复制全文"
                >
                  {copied ? <><Check size={14} /> 已复制</> : <><Copy size={14} /> 复制</>}
                </button>
                <button
                  className="plan-action-btn"
                  onClick={toggleFullscreen}
                  title={fullscreen ? '退出全屏' : '全屏'}
                >
                  {fullscreen
                    ? <><Minimize2 size={14} /> 退出全屏</>
                    : <><Maximize2 size={14} /> 全屏</>
                  }
                </button>
              </>
            )}
            <button
              className="plan-modal-icon-btn"
              onClick={() => setMinimized(m => !m)}
              title={minimized ? '展开' : '最小化'}
            >
              {minimized ? <Maximize2 size={16} /> : <Minimize2 size={16} />}
            </button>
            <button className="plan-modal-close" onClick={onClose} title="关闭">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* ── Body — hidden when minimized ── */}
        {!minimized && (
          <div className="plan-modal-body">

            {/* Left: doc + chat (stacked) */}
            <div className="plan-doc-pane">

              {/* Toolbar */}
              <div className="plan-doc-toolbar">
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <PenLine size={13} style={{ color: 'var(--text-muted)' }} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>方案文档</span>
                </div>
                {!isEditing && docContent && (
                  <button className="plan-edit-btn" onClick={startEdit}>
                    <PenLine size={12} /> 手动编辑
                  </button>
                )}
                {isEditing && (
                  <div className="plan-edit-btns">
                    <button className="plan-save-btn" onClick={saveEdit}>
                      <Check size={12} /> 保存
                    </button>
                    <button className="plan-cancel-btn" onClick={cancelEdit}>
                      <X size={12} /> 取消
                    </button>
                  </div>
                )}
              </div>

              {/* Scrollable area: doc + divider + chat */}
              <div className="plan-main-scroll" ref={mainScrollRef}>

                {/* Document section */}
                <div className="plan-doc-section">
                  {isEditing ? (
                    <textarea
                      ref={textareaRef}
                      className="plan-doc-editor"
                      value={editDraft}
                      onChange={e => setEditDraft(e.target.value)}
                      placeholder="输入方案内容（支持 Markdown）..."
                      spellCheck={false}
                    />
                  ) : (
                    <>
                      {isGenerating && !streamBuffer && (
                        <div className="plan-generating">
                          <Loader2 size={24} className="spin" />
                          <p>AI 正在撰写方案，请稍候…</p>
                        </div>
                      )}
                      {displayContent ? (
                        <div className="plan-doc-rendered">
                          <Markdown>{displayContent}</Markdown>
                        </div>
                      ) : !isGenerating ? (
                        <div className="plan-empty">
                          <Sparkles size={32} strokeWidth={1} />
                          <p>点击「重新生成」让 AI 撰写完整方案</p>
                          <button className="plan-gen-btn" onClick={handleGenerate}>
                            <Sparkles size={15} /> AI 开始撰写
                          </button>
                        </div>
                      ) : null}
                    </>
                  )}
                </div>

                {/* Chat divider */}
                <div className="plan-chat-divider">
                  <MessageSquare size={13} />
                  <span>AI 对话</span>
                  {chatMessages.length > 0 && (
                    <span className="plan-chat-badge">{chatMessages.filter(m => m.role === 'user').length}</span>
                  )}
                </div>

                {/* Chat messages */}
                <div className="plan-chat-inline">
                  {chatMessages.length === 0 && (
                    <div className="plan-chat-empty-inline">
                      <p>与 AI 对话修改或完善方案内容</p>
                      <div className="plan-chat-hints">
                        {['帮我把执行步骤写得更详细', '修改第一节的内容', '增加风险评估章节'].map(hint => (
                          <button key={hint} className="plan-chat-hint"
                            onClick={() => setChatInput(hint)}>
                            {hint}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {chatMessages.map(msg => (
                    <div key={msg.id} className={`plan-msg plan-msg--${msg.role}`}>
                      {msg.role === 'assistant' ? (
                        <div className="plan-msg-content">
                          {msg.content ? (
                            <div className="plan-msg-rendered">
                              <Markdown>{msg.content}</Markdown>
                            </div>
                          ) : (
                            <span style={{ opacity: 0.4 }}>…</span>
                          )}
                          {msg.content && !isChatting && (
                            <button
                              className="plan-apply-btn"
                              onClick={() => applyToDoc(msg.content)}
                              title="将此内容应用为文档"
                            >
                              <Check size={11} /> 应用到文档
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="plan-msg-content">{msg.content}</div>
                      )}
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>
              </div>

              {/* Chat input — fixed at bottom of pane */}
              <div className="plan-chat-input-row">
                <textarea
                  className="plan-chat-input"
                  placeholder="输入修改要求或问题…（Shift+Enter 换行，Enter 发送）"
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleChat()
                    }
                  }}
                  rows={2}
                  disabled={isChatting}
                />
                <button
                  className="plan-send-btn"
                  onClick={handleChat}
                  disabled={!chatInput.trim() || isChatting}
                >
                  {isChatting ? <Loader2 size={18} className="spin" /> : <Send size={18} />}
                </button>
              </div>
            </div>

            {/* Right: card context sidebar */}
            <div className="plan-context-pane">
              <div className="plan-context-title">方案背景</div>
              <div className="plan-context-section">
                <div className="plan-context-label">主题</div>
                <div className="plan-context-value">{context.topic}</div>
              </div>
              <div className="plan-context-section">
                <div className="plan-context-label">方案摘要</div>
                <div className="plan-context-value plan-context-summary">{card.content}</div>
              </div>
              {card.relatedKeywords.length > 0 && (
                <div className="plan-context-section">
                  <div className="plan-context-label">相关关键词</div>
                  <div className="plan-context-tags">
                    {card.relatedKeywords.map(kw => (
                      <span key={kw} className="plan-context-tag">{kw}</span>
                    ))}
                  </div>
                </div>
              )}
              {context.notes?.trim() && (
                <div className="plan-context-section">
                  <div className="plan-context-label">笔记 Note</div>
                  <div className="plan-context-value plan-context-notes">{context.notes}</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
