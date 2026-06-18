import { Component, ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

/**
 * ErrorBoundary — catches render-time errors anywhere in the subtree.
 * LLM output is untrusted; a malformed JSON.parse or undefined access
 * used to white-screen the whole app. This keeps users in a recoverable state.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Log to console for now; integrate with logger if available
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          padding: 40,
          fontFamily: '-apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
          color: '#1a1a1a',
          background: '#fbfaf6',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 48 }}>⚠️</div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 500 }}>应用遇到错误</h2>
          <p style={{ margin: 0, color: '#5f5e5a', fontSize: 14, maxWidth: 480 }}>
            通常是 AI 返回了无法解析的内容。你可以重试，或返回首页继续。
          </p>
          {this.state.error && (
            <details style={{ maxWidth: 640, width: '100%', textAlign: 'left' }}>
              <summary style={{ cursor: 'pointer', color: '#5f5e5a', fontSize: 12 }}>
                查看错误详情
              </summary>
              <pre style={{
                background: '#f3f1e8',
                border: '1px solid #d8d6cc',
                padding: 12,
                fontSize: 11.5,
                overflowX: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}>
                {this.state.error.message}
                {'\n\n'}
                {this.state.error.stack}
              </pre>
            </details>
          )}
          <div style={{ display: 'flex', gap: 12 }}>
            <button
              onClick={this.handleReset}
              style={{
                padding: '8px 18px',
                fontSize: 14,
                background: '#002FA7',
                color: 'white',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              重试
            </button>
            <button
              onClick={() => {
                this.handleReset()
                window.location.hash = ''
                window.location.reload()
              }}
              style={{
                padding: '8px 18px',
                fontSize: 14,
                background: 'white',
                color: '#1a1a1a',
                border: '1px solid #d8d6cc',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              返回首页
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
