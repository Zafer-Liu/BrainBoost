import { useState, useCallback } from 'react'
import { Lightbulb, Tag, Network, Loader2, Pencil, Trash2, Check, X, Plus, BookOpen, Lock, LockOpen } from 'lucide-react'
import { v4 as uuidv4 } from 'uuid'
import type { IdeaCard, ChatMessage } from '../../types'
import type { AppStore } from '../../store/appStore'
import { PlanDetailModal } from './PlanDetailModal'

interface Props {
  store: AppStore
  cards: IdeaCard[]
  streaming?: boolean
  onHighlightNodes?: (nodeIds: string[]) => void
}

interface EditState {
  title: string
  content: string
}

interface PlanCache {
  doc: string
  chat: ChatMessage[]
}

function IdeaCardItem({
  card, index, active, streaming,
  onHighlightNodes, onOpenDetail, store, onToggleLock,
}: {
  card: IdeaCard
  index: number
  active: boolean
  streaming: boolean
  onHighlightNodes?: (ids: string[]) => void
  onOpenDetail: () => void
  store: AppStore
  onToggleLock: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<EditState>({ title: card.title, content: card.content })

  function startEdit(e: React.MouseEvent) {
    e.stopPropagation()
    setDraft({ title: card.title, content: card.content })
    setEditing(true)
  }

  function cancelEdit(e: React.MouseEvent) {
    e.stopPropagation()
    setEditing(false)
  }

  function saveEdit(e: React.MouseEvent) {
    e.stopPropagation()
    if (!draft.title.trim()) return
    store.updateIdeaCard(card.id, { title: draft.title.trim(), content: draft.content.trim() })
    setEditing(false)
  }

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation()
    store.deleteIdeaCard(card.id)
    if (active) onHighlightNodes?.([])
  }

  function handleOpenDetail(e: React.MouseEvent) {
    e.stopPropagation()
    onOpenDetail()
  }

  function handleClick() {
    if (editing) return
    if (!onHighlightNodes) return
    if (active) {
      onHighlightNodes([])
    } else {
      onHighlightNodes(card.relatedNodeIds || [])
    }
  }

  return (
    <div
      className={`idea-card card-enter${active ? ' idea-card--active' : ''}${card.locked ? ' idea-card--locked' : ''}${!editing && onHighlightNodes ? ' idea-card--clickable' : ''}`}
      onClick={handleClick}
    >
      {editing ? (
        <div className="idea-card-edit" onClick={e => e.stopPropagation()}>
          <input
            className="idea-edit-title"
            value={draft.title}
            onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
            placeholder="方案标题"
            autoFocus
          />
          <textarea
            className="idea-edit-content"
            value={draft.content}
            onChange={e => setDraft(d => ({ ...d, content: e.target.value }))}
            placeholder="方案详细描述"
            rows={4}
          />
          <div className="idea-edit-actions">
            <button className="idea-edit-btn save" onClick={saveEdit} title="保存">
              <Check size={13} /> 保存
            </button>
            <button className="idea-edit-btn cancel" onClick={cancelEdit} title="取消">
              <X size={13} /> 取消
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="idea-card-header">
            <span className="idea-number">{index + 1}</span>
            <h4>{card.title}</h4>
            {(card.relatedNodeIds?.length ?? 0) > 0 && (
              <span className="idea-node-count" title="关联节点数">
                <Network size={11} /> {card.relatedNodeIds.length}
              </span>
            )}
            {!streaming && (
              <div className="idea-card-actions">
                <button
                  className={`idea-action-btn${card.locked ? ' lock-on' : ''}`}
                  onClick={e => { e.stopPropagation(); onToggleLock() }}
                  title={card.locked ? '已锁定（点击解锁）' : '锁定方案'}
                >
                  {card.locked ? <Lock size={12} /> : <LockOpen size={12} />}
                </button>
                <button className="idea-action-btn detail" onClick={handleOpenDetail} title="详细方案">
                  <BookOpen size={12} />
                </button>
                <button className="idea-action-btn" onClick={startEdit} title="编辑摘要">
                  <Pencil size={12} />
                </button>
                <button className="idea-action-btn danger" onClick={handleDelete} title="删除">
                  <Trash2 size={12} />
                </button>
              </div>
            )}
          </div>
          <p>{card.content}</p>
          {card.relatedKeywords.length > 0 && (
            <div className="idea-tags">
              <Tag size={12} />
              {card.relatedKeywords.map(kw => (
                <span key={kw} className="idea-tag">{kw}</span>
              ))}
            </div>
          )}
          {active && (card.relatedNodeIds?.length ?? 0) > 0 && (
            <div className="idea-hint">↖ 思维导图已高亮关联节点</div>
          )}
          {!streaming && (
            <button className="idea-detail-btn" onClick={handleOpenDetail}>
              <BookOpen size={12} /> 查看详细方案
            </button>
          )}
        </>
      )}
    </div>
  )
}

function lsKey(sessionId: string) {
  return `plan_cache_${sessionId}`
}

function loadCache(sessionId: string): Map<string, PlanCache> {
  try {
    const raw = localStorage.getItem(lsKey(sessionId))
    if (!raw) return new Map()
    const obj = JSON.parse(raw) as Record<string, PlanCache>
    return new Map(Object.entries(obj))
  } catch {
    return new Map()
  }
}

function saveCache(sessionId: string, cache: Map<string, PlanCache>) {
  try {
    const obj = Object.fromEntries(cache)
    localStorage.setItem(lsKey(sessionId), JSON.stringify(obj))
  } catch { /* quota exceeded etc. */ }
}

export function IdeaCardsPanel({ store, cards, streaming = false, onHighlightNodes }: Props) {
  const [activeCard, setActiveCard] = useState<string | null>(null)
  const [addingNew, setAddingNew] = useState(false)
  const [newDraft, setNewDraft] = useState<EditState>({ title: '', content: '' })
  const [detailCard, setDetailCard] = useState<IdeaCard | null>(null)

  const session = store.currentSession

  // planCache is initialized from localStorage keyed by session id
  const [planCache, setPlanCache] = useState<Map<string, PlanCache>>(() =>
    session ? loadCache(session.id) : new Map()
  )

  const handleSave = useCallback((cardId: string, doc: string, chat: ChatMessage[]) => {
    setPlanCache(prev => {
      const next = new Map(prev)
      next.set(cardId, { doc, chat })
      if (session) saveCache(session.id, next)
      return next
    })
  }, [session])

  function handleHighlight(cardId: string, nodeIds: string[]) {
    if (activeCard === cardId) {
      setActiveCard(null)
      onHighlightNodes?.([])
    } else {
      setActiveCard(cardId)
      onHighlightNodes?.(nodeIds)
    }
  }

  function startAddNew() {
    setNewDraft({ title: '', content: '' })
    setAddingNew(true)
  }

  function cancelAddNew() {
    setAddingNew(false)
  }

  function saveNew() {
    if (!newDraft.title.trim()) return
    store.addIdeaCard({
      id: uuidv4(),
      title: newDraft.title.trim(),
      content: newDraft.content.trim(),
      relatedKeywords: [],
      relatedNodeIds: [],
      createdAt: Date.now(),
    })
    setAddingNew(false)
    setNewDraft({ title: '', content: '' })
  }

  return (
    <>
      <div className="idea-cards-panel">
        <div className="panel-header">
          <h3><Lightbulb size={16} /> AI 推导方案</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
            {streaming
              ? <span className="badge streaming"><Loader2 size={12} className="spin" /> 生成中</span>
              : <span className="badge">{cards.length}</span>
            }
            {!streaming && (
              <button className="icon-btn" onClick={startAddNew} title="新增方案" style={{ width: 26, height: 26 }}>
                <Plus size={14} />
              </button>
            )}
          </div>
        </div>

        {cards.length === 0 && !streaming && !addingNew ? (
          <div className="cards-empty">
            <Lightbulb size={32} strokeWidth={1} />
            <p>AI 分析后，方案将在这里展示</p>
            <button className="btn-add-card" onClick={startAddNew}>
              <Plus size={14} /> 手动添加方案
            </button>
          </div>
        ) : cards.length === 0 && streaming ? (
          <div className="cards-empty">
            <Loader2 size={32} strokeWidth={1} className="spin" />
            <p>正在推导方案…</p>
          </div>
        ) : (
          <div className="cards-list">
            {cards.map((card, i) => (
              <IdeaCardItem
                key={card.id}
                card={card}
                index={i}
                active={activeCard === card.id}
                streaming={streaming}
                store={store}
                onHighlightNodes={(ids) => handleHighlight(card.id, ids)}
                onOpenDetail={() => setDetailCard(card)}
                onToggleLock={() => store.toggleCardLock(card.id)}
              />
            ))}

            {addingNew && (
              <div className="idea-card idea-card-new">
                <div className="idea-card-edit">
                  <input
                    className="idea-edit-title"
                    value={newDraft.title}
                    onChange={e => setNewDraft(d => ({ ...d, title: e.target.value }))}
                    placeholder="方案标题"
                    autoFocus
                    onKeyDown={e => e.key === 'Enter' && saveNew()}
                  />
                  <textarea
                    className="idea-edit-content"
                    value={newDraft.content}
                    onChange={e => setNewDraft(d => ({ ...d, content: e.target.value }))}
                    placeholder="方案详细描述（可选）"
                    rows={3}
                  />
                  <div className="idea-edit-actions">
                    <button className="idea-edit-btn save" onClick={saveNew}>
                      <Check size={13} /> 添加
                    </button>
                    <button className="idea-edit-btn cancel" onClick={cancelAddNew}>
                      <X size={13} /> 取消
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {detailCard && session && (
        <PlanDetailModal
          card={detailCard}
          context={{
            topic: session.topic,
            keywords: session.keywords.map(k => k.text),
            notes: session.notes,
          }}
          config={store.llmConfig}
          initialDoc={planCache.get(detailCard.id)?.doc ?? ''}
          initialChat={planCache.get(detailCard.id)?.chat ?? []}
          onSave={handleSave}
          onClose={() => setDetailCard(null)}
        />
      )}
    </>
  )
}
