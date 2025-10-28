import React, { useEffect, useRef, useState } from 'react'

type Source = { id: string; name: string; thumbnail: string | null }

type Props = {
  onRecordingComplete?: (filePath: string) => void
  videoRef?: React.RefObject<HTMLVideoElement>
  setIsRecording?: (recording: boolean) => void
}

export default function ScreenCapture({ onRecordingComplete, videoRef: externalVideoRef, setIsRecording }: Props) {
  const [sources, setSources] = useState<Source[]>([])
  const [chosen, setChosen] = useState<Source | null>(null)
  const [includeMic, setIncludeMic] = useState(true)
  const [recording, setRecording] = useState(false)
  const [status, setStatus] = useState('')
  const [recordingDuration, setRecordingDuration] = useState(0)

  const previewRef = useRef<HTMLVideoElement>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const startTimeRef = useRef<number>(0)

  useEffect(() => {
    // @ts-expect-error preload
    if (window.clipforge?.getDesktopSources) {
      // @ts-expect-error preload
      window.clipforge.getDesktopSources({ types: ['screen', 'window'] })
        .then((allSources: Source[]) => {
          // Sort so screens come first, then windows
          const sorted = allSources.sort((a, b) => {
            const aIsScreen = a.name.toLowerCase().includes('screen') || a.name.toLowerCase().includes('entire')
            const bIsScreen = b.name.toLowerCase().includes('screen') || b.name.toLowerCase().includes('entire')
            if (aIsScreen && !bIsScreen) return -1
            if (!aIsScreen && bIsScreen) return 1
            return 0
          })
          setSources(sorted)
        })
        .catch(console.error)
    }
  }, [])

  async function start() {
    if (!chosen) { setStatus('Pick a source'); return }
    try {
      setStatus('Requesting capture…')
      // Video from desktop
      const desk = await (navigator.mediaDevices as any).getUserMedia({
        audio: false, // system audio on macOS is limited; keep false for reliability
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: chosen.id,
            maxFrameRate: 30,
            minWidth: 1280, maxWidth: 1920,
            minHeight: 720,  maxHeight: 1080,
          }
        }
      })

      // Optional mic
      let mic: MediaStream | null = null
      if (includeMic) {
        try { mic = await navigator.mediaDevices.getUserMedia({ audio: true, video: false }) }
        catch { /* mic denied, proceed without */ }
      }

      const combined = new MediaStream([
        ...desk.getVideoTracks(),
        ...(mic ? mic.getAudioTracks() : []),
      ])

      mediaStreamRef.current = combined
      
      // Set up preview video - use external video ref if provided
      const preview = externalVideoRef?.current || previewRef.current
      console.log('[ScreenCapture] Setting up preview, video element:', preview)
      if (preview) {
        // Clear any existing src
        preview.removeAttribute('src')
        preview.load()
        
        preview.srcObject = combined
        preview.muted = true
        preview.autoplay = true
        
        console.log('[ScreenCapture] Set srcObject, tracks:', combined.getTracks().map(t => ({ kind: t.kind, enabled: t.enabled })))
        
        // Force play after a tiny delay to ensure srcObject is set
        setTimeout(() => {
          console.log('[ScreenCapture] Attempting to play preview')
          preview.play().catch(err => console.error('Preview play failed:', err))
        }, 100)
      } else {
        console.error('[ScreenCapture] No video element available for preview!')
      }

      const mime =
        MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
          ? 'video/webm;codecs=vp9'
          : 'video/webm;codecs=vp8'
      const rec = new MediaRecorder(combined, { mimeType: mime, videoBitsPerSecond: 6_000_000 })
      chunksRef.current = []
      rec.ondataavailable = (e) => { if (e.data?.size) chunksRef.current.push(e.data) }
      rec.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: mime })
        const bytes = new Uint8Array(await blob.arrayBuffer())
        // @ts-expect-error preload
        const res = await window.clipforge.saveBytes(`recording-${Date.now()}.webm`, bytes)
        if (res.saved && res.path) {
          setStatus('Saved ✅ Adding to timeline…')
          onRecordingComplete?.(res.path)
          setTimeout(() => setStatus(''), 2000)
        } else {
          setStatus('Canceled')
        }
      }
      rec.start()
      recorderRef.current = rec
      setRecording(true)
      setIsRecording?.(true)
      setStatus('Recording…')
      
      // Start timer
      startTimeRef.current = Date.now()
      setRecordingDuration(0)
      timerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000)
        setRecordingDuration(elapsed)
      }, 1000)
    } catch (err: any) {
      console.error(err)
      setStatus(err?.message || 'Failed to start recording — macOS may need Screen Recording permission (System Settings → Privacy & Security).')
    }
  }

  function stop() {
    recorderRef.current?.stop()
    mediaStreamRef.current?.getTracks().forEach(t => t.stop())
    
    // Clear preview from whichever video element was used
    const preview = externalVideoRef?.current || previewRef.current
    if (preview) {
      preview.srcObject = null
    }
    
    // Stop timer
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    
    recorderRef.current = null
    mediaStreamRef.current = null
    setRecording(false)
    setIsRecording?.(false)
    setStatus('Finalizing…')
  }
  
  // Format duration as MM:SS
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  return (
    <div style={{ padding:'10px', display:'flex', flexDirection:'column', gap:10 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        {chosen && !recording && (
          <button onClick={() => setChosen(null)} style={{ fontSize:11, padding:'2px 8px' }}>
            Change Source
          </button>
        )}
      </div>

      {/* Show picker only when no source chosen */}
      {!recording && !chosen && sources.length > 0 && (
        <div style={{ 
          border: '1px solid #eee',
          borderRadius: 8,
          background: '#fafafa',
          height: '160px',
          overflowY: 'scroll',
          overflowX: 'hidden',
          padding: '10px'
        }}>
          <div style={{
            display:'grid',
            gridTemplateColumns: 'repeat(auto-fill, 180px)',
            gap: 10
          }}>
            {sources.map(s => (
              <button 
                key={s.id}
                onClick={() => setChosen(s)}
                title={s.name}
                style={{
                  border: '1px solid #ddd',
                  borderRadius: 6, 
                  padding: 8, 
                  textAlign:'left', 
                  background:'#fff', 
                  cursor:'pointer',
                  display: 'flex',
                  flexDirection: 'column'
                }}>
                {s.thumbnail ? (
                  <img 
                    src={s.thumbnail} 
                    alt={s.name} 
                    style={{ 
                      width:'100%', 
                      height:100, 
                      objectFit:'cover', 
                      borderRadius:4,
                      display: 'block',
                      marginBottom: 6
                    }} 
                  />
                ) : (
                  <div style={{
                    width:'100%', 
                    height:100,
                    background: '#333',
                    borderRadius:4,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: 6,
                    color: '#888',
                    fontSize: 10
                  }}>
                    No Preview
                  </div>
                )}
                <div style={{ 
                  fontSize:11, 
                  overflow:'hidden', 
                  textOverflow:'ellipsis',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  lineHeight: '14px',
                  maxHeight: '28px',
                  wordBreak: 'break-word'
                }}>
                  {s.name}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Show selected source info when chosen */}
      {chosen && !recording && (
        <div style={{ 
          padding: 8, 
          background: '#f0f9ff', 
          border: '2px solid #2563eb', 
          borderRadius: 6,
          fontSize: 13
        }}>
          📹 Selected: <strong>{chosen.name}</strong>
        </div>
      )}

      {/* Controls - always visible */}
      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
        <label style={{ fontSize:13, display:'flex', alignItems:'center', gap:6 }}>
          <input type="checkbox" checked={includeMic} onChange={e=>setIncludeMic(e.target.checked)} />
          Include microphone
        </label>

        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          {!recording
            ? <button onClick={start} disabled={!chosen} style={{ padding:'6px 12px' }}>⏺ Start Recording</button>
            : <button onClick={stop} style={{ padding:'6px 12px' }}>⏹ Stop & Save</button>
          }
          <span style={{ fontSize:12, color:'#555' }}>{status}</span>
        </div>
      </div>

      {/* Recording status and timer */}
      {recording && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, padding: 8, background: '#fee', borderRadius: 6 }}>
          <div style={{ fontSize:12, fontWeight:'bold', color:'#dc2626' }}>
            🔴 Recording in progress...
          </div>
          <div style={{ 
            fontSize: 16, 
            fontWeight: 'bold', 
            color: '#dc2626',
            fontFamily: 'monospace'
          }}>
            {formatDuration(recordingDuration)}
          </div>
        </div>
      )}
      
      {/* Fallback local preview if no external video ref provided */}
      {!externalVideoRef && recording && (
        <video 
          ref={previewRef} 
          autoPlay
          playsInline
          muted
          style={{ 
            width: '100%',
            height: 'auto',
            maxHeight: '400px',
            background: '#000',
            borderRadius: 8,
            border: '2px solid #dc2626',
            display: 'block',
            objectFit: 'contain',
            marginTop: 10
          }} 
        />
      )}
    </div>
  )
}

