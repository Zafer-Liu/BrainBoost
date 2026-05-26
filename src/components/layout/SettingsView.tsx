import { useState } from 'react'
import { ArrowLeft, Eye, EyeOff, Check } from 'lucide-react'
import type { AppStore } from '../../store/appStore'
import type { LLMConfig } from '../../types'

interface Props {
  store: AppStore
}

const PROVIDER_MODELS: Record<string, string[]> = {
  claude: ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
  custom: [],
}

export function SettingsView({ store }: Props) {
  const [config, setConfig] = useState<LLMConfig>({ ...store.llmConfig })
  const [showKey, setShowKey] = useState(false)
  const [saved, setSaved] = useState(false)

  function handleSave() {
    store.setLLMConfig(config)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const models = PROVIDER_MODELS[config.provider] || []

  return (
    <div className="settings-view">
      <header className="settings-header">
        <button className="icon-btn" onClick={() => store.setView(store.currentSession ? 'session' : 'home')}>
          <ArrowLeft size={20} />
        </button>
        <h2>设置</h2>
      </header>

      <main className="settings-main">
        <section className="settings-section">
          <h3>LLM 配置</h3>

          <label className="form-label">AI 提供商</label>
          <div className="provider-tabs">
            {(['claude', 'openai', 'custom'] as const).map(p => (
              <button
                key={p}
                className={`provider-tab ${config.provider === p ? 'active' : ''}`}
                onClick={() => setConfig(c => ({
                  ...c,
                  provider: p,
                  model: PROVIDER_MODELS[p]?.[0] || '',
                  baseURL: p === 'custom' ? 'https://api.openai.com/v1' : undefined,
                }))}
              >
                {p === 'claude' ? 'Claude (Anthropic)' : p === 'openai' ? 'OpenAI' : '自定义'}
              </button>
            ))}
          </div>

          <label className="form-label">API Key</label>
          <div className="input-with-toggle">
            <input
              type={showKey ? 'text' : 'password'}
              className="text-input"
              placeholder={
                config.provider === 'claude' ? 'sk-ant-...' :
                config.provider === 'openai' ? 'sk-...' : 'API Key'
              }
              value={config.apiKey}
              onChange={e => setConfig(c => ({ ...c, apiKey: e.target.value }))}
            />
            <button className="icon-btn" onClick={() => setShowKey(v => !v)}>
              {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          {config.provider === 'custom' && (
            <>
              <label className="form-label">Base URL</label>
              <input
                type="text"
                className="text-input"
                placeholder="https://api.openai.com/v1"
                value={config.baseURL || ''}
                onChange={e => setConfig(c => ({ ...c, baseURL: e.target.value }))}
              />
              <label className="form-label checkbox-label">
                <input
                  type="checkbox"
                  checked={!!config.disableThinking}
                  onChange={e => setConfig(c => ({ ...c, disableThinking: e.target.checked }))}
                />
                禁用思考模式（适用于 MiniMax-M2、DeepSeek-R1 等思考型模型，开启后可获得真正的流式输出）
              </label>
            </>
          )}

          <label className="form-label">模型</label>
          {models.length > 0 ? (
            <select
              className="text-input"
              value={config.model}
              onChange={e => setConfig(c => ({ ...c, model: e.target.value }))}
            >
              {models.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          ) : (
            <input
              type="text"
              className="text-input"
              placeholder="模型名称，例如：gpt-4o"
              value={config.model}
              onChange={e => setConfig(c => ({ ...c, model: e.target.value }))}
            />
          )}
        </section>

        <button className="btn-primary" onClick={handleSave}>
          {saved ? <><Check size={16} /> 已保存</> : '保存设置'}
        </button>

        <p className="settings-note">API Key 仅保存在本地，不会上传到任何服务器。</p>
      </main>
    </div>
  )
}
