import React, { useState, useEffect } from 'react'

type Props = {
  onClose: () => void
}

export default function Settings({ onClose }: Props) {
  const [apiKey, setApiKey] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [ffmpegStatus, setFfmpegStatus] = useState<string>('')
  const [ffmpegTesting, setFfmpegTesting] = useState(false)

  useEffect(() => {
    // Load existing settings
    // @ts-expect-error preload
    window.clipforge?.settingsLoad?.().then((settings: any) => {
      if (settings?.openaiApiKey) {
        setApiKey(settings.openaiApiKey)
      }
      setLoading(false)
    }).catch(() => {
      setLoading(false)
    })
  }, [])

  async function handleSave() {
    setSaving(true)
    try {
      // @ts-expect-error preload
      await window.clipforge.settingsSave({ openaiApiKey: apiKey })
      alert('Settings saved! Your API key is stored securely on your device.')
      onClose()
    } catch (err: any) {
      alert(`Failed to save: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  async function testFFmpeg() {
    setFfmpegTesting(true)
    setFfmpegStatus('Testing FFmpeg...')
    try {
      // @ts-expect-error preload
      const result = await window.clipforge.testFFmpeg()
      if (result.success) {
        setFfmpegStatus(`✅ FFmpeg works! ${result.output?.split('\n')[0] || ''}`)
      } else {
        setFfmpegStatus(`❌ FFmpeg failed: ${result.error || 'Unknown error'}\nPath: ${result.path || 'unknown'}`)
      }
    } catch (err: any) {
      setFfmpegStatus(`❌ Error testing FFmpeg: ${err.message}`)
    } finally {
      setFfmpegTesting(false)
    }
  }

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999
    }}>
      <div style={{
        background: 'white',
        borderRadius: 12,
        padding: 24,
        width: '90%',
        maxWidth: 500,
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>⚙️ Settings</h2>
          <button 
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: 24,
              cursor: 'pointer',
              padding: 4,
              lineHeight: 1
            }}
          >
            ×
          </button>
        </div>

        {loading ? (
          <div style={{ padding: 20, textAlign: 'center', color: '#666' }}>
            Loading settings...
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ display: 'block', marginBottom: 8, fontWeight: 'bold', fontSize: 14 }}>
                OpenAI API Key
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-..."
                  style={{
                    width: '100%',
                    padding: '8px 40px 8px 12px',
                    fontSize: 14,
                    border: '1px solid #ddd',
                    borderRadius: 6,
                    fontFamily: 'monospace',
                    boxSizing: 'border-box'
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  style={{
                    position: 'absolute',
                    right: 8,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 18,
                    padding: 4
                  }}
                  title={showKey ? 'Hide' : 'Show'}
                >
                  {showKey ? '🙈' : '👁️'}
                </button>
              </div>
              <div style={{ fontSize: 12, color: '#666', marginTop: 8 }}>
                Required for AI Summary feature. Get your key at{' '}
                <a 
                  href="https://platform.openai.com/api-keys" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  style={{ color: '#2563eb' }}
                >
                  platform.openai.com/api-keys
                </a>
              </div>
              <div style={{ 
                fontSize: 11, 
                color: '#059669', 
                marginTop: 6,
                padding: 8,
                background: '#d1fae5',
                borderRadius: 4
              }}>
                🔒 Your API key is stored locally on your device and never shared.
              </div>
            </div>

            {/* FFmpeg Diagnostics */}
            <div style={{ 
              padding: 12, 
              background: '#f9fafb', 
              border: '1px solid #e5e7eb',
              borderRadius: 6
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <label style={{ fontSize: 13, fontWeight: 'bold' }}>
                  FFmpeg Diagnostics
                </label>
                <button
                  onClick={testFFmpeg}
                  disabled={ffmpegTesting}
                  style={{
                    padding: '4px 12px',
                    fontSize: 12,
                    border: '1px solid #ddd',
                    borderRadius: 4,
                    background: 'white',
                    cursor: ffmpegTesting ? 'wait' : 'pointer'
                  }}
                >
                  {ffmpegTesting ? 'Testing...' : '🔧 Test FFmpeg'}
                </button>
              </div>
              <div style={{ 
                fontSize: 11, 
                color: '#666',
                marginBottom: 4
              }}>
                Required for AI Summary and video export features
              </div>
              {ffmpegStatus && (
                <div style={{ 
                  fontSize: 11,
                  fontFamily: 'monospace',
                  padding: 8,
                  background: ffmpegStatus.includes('✅') ? '#d1fae5' : '#fee2e2',
                  color: ffmpegStatus.includes('✅') ? '#065f46' : '#991b1b',
                  borderRadius: 4,
                  marginTop: 8,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all'
                }}>
                  {ffmpegStatus}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
              <button
                onClick={onClose}
                style={{
                  padding: '8px 16px',
                  fontSize: 14,
                  border: '1px solid #ddd',
                  borderRadius: 6,
                  background: 'white',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !apiKey}
                style={{
                  padding: '8px 16px',
                  fontSize: 14,
                  border: 'none',
                  borderRadius: 6,
                  background: apiKey ? '#2563eb' : '#ccc',
                  color: 'white',
                  cursor: apiKey ? 'pointer' : 'not-allowed',
                  fontWeight: 'bold'
                }}
              >
                {saving ? 'Saving...' : 'Save Settings'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

