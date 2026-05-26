import { useState, useCallback, useEffect } from 'react'
import { X, Loader2, TriangleAlert, Plus, Check, ScanSearch, Merge, Zap, Compass, Layers } from 'lucide-react'
import type { LLMConfig } from '../../types'
import type { AppStore } from '../../store/appStore'
import { analyzeKeywords, type KeywordAnalysisResult } from '../../services/llmService'

interface Props {
  store: AppStore
  config: LLMConfig
  onClose: () => void
}

export function KeywordAnalysisModal({ store, config, onClose }: Props) {
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [result, setResult] = useState<KeywordAnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [removedKeywords, setRemovedKeywords] = useState<Set<string>>(new Set())
  const [addedKeywords, setAddedKeywords] = useState<Set<string>>(new Set())

  const keywords = store.currentSession?.keywords ?? []
  const topic = store.currentSession?.topic ?? ''

  const runAnalysis = useCallback(async () => {
    if (keywords.length < 2) return
    setIsAnalyzing(true)
    setStreamText('')
    setResult(null)
    setError(null)
    setRemovedKeywords(new Set())
    setAddedKeywords(new Set())

    await analyzeKeywords(
      config,
      topic,
      keywords.map(k => k.text),
      (chunk) => {
        const thinkEnd = chunk.lastIndexOf('</think>')
        setStreamText(thinkEnd >= 0 ? chunk.slice(thinkEnd + 8) : chunk)
      },
      (res) => {
        setResult(res)
        setStreamText('')
        setIsAnalyzing(false)
      },
      (err) => {
        setError(err.message)
        setIsAnalyzing(false)
      },
    )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, topic, keywords.length])

  // Auto-run on open
  useEffect(() => { runAnalysis() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function removeKeyword(word: string) {
    const kw = keywords.find(k => k.text === word)
    if (!kw) return
    store.removeKeyword(kw.id)
    setRemovedKeywords(prev => new Set([...prev, word]))
  }

  function addKeyword(word: string) {
    if (keywords.find(k => k.text === word)) return
    store.addKeyword(word)
    setAddedKeywords(prev => new Set([...prev, word]))
  }

  // Live set of current keyword texts (updates as user removes)
  const currentWords = new Set(keywords.map(k => k.text))

  return (
    <div className="kwa-overlay" onClick={onClose}>
      <div className="kwa-modal" onClick={e => e.stopPropagation()}>

        {/* ── Header ── */}
        <div className="kwa-header">
          <div className="kwa-title">
            <ScanSearch size={15} />
            <span>关键词诊断</span>
            <span className="kwa-topic-badge">{topic}</span>
          </div>
          <div className="kwa-header-actions">
            <button className="kwa-rerun-btn" onClick={runAnalysis} disabled={isAnalyzing}>
              {isAnalyzing
                ? <><Loader2 size={12} className="spin" /> 分析中</>
                : <><ScanSearch size={12} /> 重新分析</>}
            </button>
            <button className="kwa-close" onClick={onClose}><X size={17} /></button>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="kwa-body">

          {/* Loading state */}
          {isAnalyzing && (
            <div className="kwa-loading">
              <Loader2 size={28} className="spin" />
              <p>AI 正在诊断关键词…</p>
              {streamText && <pre className="kwa-stream-preview">{streamText.slice(0, 400)}</pre>}
            </div>
          )}

          {/* Error */}
          {error && !isAnalyzing && (
            <div className="kwa-error">
              <TriangleAlert size={15} />
              <span>{error}</span>
            </div>
          )}

          {/* Results */}
          {result && !isAnalyzing && (
            <div className="kwa-result">

              {/* ── 语义分组 ── */}
              <section className="kwa-section">
                <div className="kwa-section-header">
                  <Layers size={13} />
                  <span>语义分组</span>
                  <span className="kwa-badge">{result.groups.length} 组</span>
                </div>
                <div className="kwa-groups">
                  {result.groups.map(g => (
                    <div key={g.name} className="kwa-group" style={{ borderColor: g.color + '66' }}>
                      <div className="kwa-group-name" style={{ color: g.color, background: g.color + '18' }}>
                        {g.name}
                      </div>
                      <div className="kwa-group-tags">
                        {g.keywords.map(w => (
                          <KwTag
                            key={w}
                            word={w}
                            color={g.color}
                            exists={currentWords.has(w)}
                            removed={removedKeywords.has(w)}
                            onRemove={() => removeKeyword(w)}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* ── 矛盾词对 ── */}
              {result.conflicts.length > 0 && (
                <section className="kwa-section">
                  <div className="kwa-section-header">
                    <Zap size={13} />
                    <span>矛盾词对</span>
                    <span className="kwa-badge kwa-badge--warn">{result.conflicts.length} 对</span>
                  </div>
                  <div className="kwa-conflicts">
                    {result.conflicts.map((c, i) => (
                      <div key={i} className="kwa-conflict-row">
                        <div className="kwa-conflict-pair">
                          <KwTag word={c.a} exists={currentWords.has(c.a)} removed={removedKeywords.has(c.a)} onRemove={() => removeKeyword(c.a)} />
                          <span className="kwa-vs">vs</span>
                          <KwTag word={c.b} exists={currentWords.has(c.b)} removed={removedKeywords.has(c.b)} onRemove={() => removeKeyword(c.b)} />
                        </div>
                        <p className="kwa-conflict-reason">{c.reason}</p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* ── 相近/重复词 ── */}
              {result.duplicates.length > 0 && (
                <section className="kwa-section">
                  <div className="kwa-section-header">
                    <Merge size={13} />
                    <span>相近 / 重复词</span>
                    <span className="kwa-badge kwa-badge--warn">{result.duplicates.length} 组</span>
                  </div>
                  <div className="kwa-duplicates">
                    {result.duplicates.map((d, i) => (
                      <div key={i} className="kwa-dup-row">
                        <div className="kwa-dup-words">
                          {d.words.map(w => (
                            <KwTag key={w} word={w} exists={currentWords.has(w)} removed={removedKeywords.has(w)} onRemove={() => removeKeyword(w)} />
                          ))}
                        </div>
                        <div className="kwa-dup-suggestion">
                          <span className="kwa-dup-label">建议→</span>
                          <span className="kwa-dup-text">{d.suggestion}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* ── 建议补充维度 ── */}
              {result.missing.length > 0 && (
                <section className="kwa-section">
                  <div className="kwa-section-header">
                    <Compass size={13} />
                    <span>建议补充维度</span>
                  </div>
                  <div className="kwa-missing">
                    {result.missing.map((m, i) => (
                      <div key={i} className="kwa-miss-row">
                        <div className="kwa-miss-dim">{m.dimension}</div>
                        <div className="kwa-miss-examples">
                          {m.examples.map(ex => {
                            const already = currentWords.has(ex) || addedKeywords.has(ex)
                            return (
                              <button
                                key={ex}
                                className={`kwa-add-chip${already ? ' kwa-add-chip--done' : ''}`}
                                onClick={() => !already && addKeyword(ex)}
                                title={already ? '已添加' : '点击添加到关键词'}
                                disabled={already}
                              >
                                {already ? <Check size={10} /> : <Plus size={10} />}
                                {ex}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

            </div>
          )}
        </div>

        {/* ── Footer ── */}
        {(result || error) && !isAnalyzing && (
          <div className="kwa-footer">
            <span className="kwa-footer-summary">
              {removedKeywords.size > 0 && `已删除 ${removedKeywords.size} 个`}
              {removedKeywords.size > 0 && addedKeywords.size > 0 && ' · '}
              {addedKeywords.size > 0 && `已添加 ${addedKeywords.size} 个`}
              {removedKeywords.size === 0 && addedKeywords.size === 0 && '点击 × 删除词，点击 + 添加建议词'}
            </span>
            <button className="kwa-done-btn" onClick={onClose}>
              <Check size={12} /> 完成
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── 词标签组件 ─────────────────────────────────────────────────────
function KwTag({ word, exists, removed, onRemove, color }: {
  word: string
  exists: boolean
  removed: boolean
  onRemove: () => void
  color?: string
}) {
  return (
    <span
      className={`kwa-tag${removed ? ' kwa-tag--removed' : ''}`}
      style={color && !removed ? { borderColor: color + '80', color: color, background: color + '12' } : undefined}
    >
      {word}
      {exists && !removed && (
        <button className="kwa-tag-del" onClick={onRemove} title="删除此关键词">
          <X size={10} />
        </button>
      )}
      {removed && <span className="kwa-tag-removed-mark">已删</span>}
    </span>
  )
}
