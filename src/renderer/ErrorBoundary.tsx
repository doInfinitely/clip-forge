import React from 'react'

type Props = {
  children: React.ReactNode
}

type State = {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error)
    console.error('[ErrorBoundary] Error info:', errorInfo)
    console.error('[ErrorBoundary] Stack:', error.stack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, fontFamily: 'monospace' }}>
          <h1 style={{ color: 'red' }}>⚠️ App Crashed</h1>
          <p><strong>Error:</strong> {this.state.error?.message}</p>
          <pre style={{ background: '#f5f5f5', padding: 20, overflow: 'auto' }}>
            {this.state.error?.stack}
          </pre>
          <button 
            onClick={() => window.location.reload()} 
            style={{ padding: '10px 20px', fontSize: 16, cursor: 'pointer' }}
          >
            Reload App
          </button>
        </div>
      )
    }

    return this.props.children
  }
}

