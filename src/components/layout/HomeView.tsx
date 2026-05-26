import { useState } from 'react'
import { Plus, Brain, Clock, Trash2, Settings } from 'lucide-react'
import type { AppStore } from '../../store/appStore'

interface Props {
  store: AppStore
}

export function HomeView({ store }: Props) {
  const [newTopic, setNewTopic] = useState('')

  function handleCreate() {
    const topic = newTopic.trim()
    if (!topic) return
    store.createSession(topic)
    setNewTopic('')
  }

  return (
    <div className="home-view">
      <header className="home-header">
        <div className="logo">
          <Brain size={32} />
          <span>BrainSpark</span>
        </div>
        <button className="icon-btn" onClick={() => store.setView('settings')} title="设置">
          <Settings size={20} />
        </button>
      </header>

      <main className="home-main">
        <div className="hero">
          <h1>AI 头脑风暴助手</h1>
          <p>输入主题，记录关键词，AI 自动推理关联</p>
        </div>

        <div className="new-session-form">
          <input
            className="topic-input"
            placeholder="输入头脑风暴主题，例如：新产品营销策略..."
            value={newTopic}
            onChange={e => setNewTopic(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
          />
          <button className="btn-primary" onClick={handleCreate} disabled={!newTopic.trim()}>
            <Plus size={18} />
            开始头脑风暴
          </button>
        </div>

        {store.sessions.length > 0 && (
          <section className="sessions-section">
            <h2><Clock size={16} /> 历史记录</h2>
            <div className="sessions-grid">
              {store.sessions.map(s => (
                <div key={s.id} className="session-card" onClick={() => store.openSession(s)}>
                  <div className="session-card-content">
                    <h3>{s.topic}</h3>
                    <p>{s.keywords.length} 个关键词 · {s.ideaCards.length} 个方案</p>
                    <time>{new Date(s.updatedAt).toLocaleString('zh-CN')}</time>
                  </div>
                  <button
                    className="icon-btn danger"
                    onClick={e => { e.stopPropagation(); store.deleteSession(s.id) }}
                    title="删除"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
