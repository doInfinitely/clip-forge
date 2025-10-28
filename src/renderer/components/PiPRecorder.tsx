import React, { useEffect, useRef, useState } from 'react'

type Source = { id: string; name: string; thumbnail: string | null }
type Corner = 'top-left'|'top-right'|'bottom-left'|'bottom-right'

type Props = {
  onRecordingComplete?: (filePath: string) => void
  videoRef?: React.RefObject<HTMLVideoElement>
  setIsRecording?: (recording: boolean) => void
}

export default function PiPRecorder({ onRecordingComplete, videoRef: externalVideoRef, setIsRecording }: Props) {
  const [sources, setSources] = useState<Source[]>([])
  const [chosen, setChosen] = useState<Source | null>(null)
  const [cams, setCams] = useState<MediaDeviceInfo[]>([])
  const [camId, setCamId] = useState<string | null>(null)
  const [includeMic, setIncludeMic] = useState(true)
  const [pipCorner, setPipCorner] = useState<Corner>('bottom-right')
  const [pipScale, setPipScale] = useState(0.25) // relative to screen video height
  const [status, setStatus] = useState('')
  const [recording, setRecording] = useState(false)
  const [recordingDuration, setRecordingDuration] = useState(0)

  const screenVidRef = useRef<HTMLVideoElement>(null)
  const camVidRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const screenStreamRef = useRef<MediaStream | null>(null)
  const camStreamRef = useRef<MediaStream | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const canvasStreamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)
  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const startTimeRef = useRef<number>(0)

  // Load desktop sources + cameras
  useEffect(() => {
    console.log('[PiPRecorder] Loading sources...')
    // @ts-expect-error preload
    if (window.clipforge?.getDesktopSources) {
      // @ts-expect-error preload
      window.clipforge.getDesktopSources({ types: ['screen', 'window'] })
        .then((list: Source[]) => {
          console.log('[PiPRecorder] Got desktop sources:', list.length, list)
          const sorted = list.sort((a,b)=>{
            const aS = /screen|entire/i.test(a.name); const bS = /screen|entire/i.test(b.name)
            return aS === bS ? 0 : aS ? -1 : 1
          })
          setSources(sorted)
        }).catch(err => {
          console.error('[PiPRecorder] Error getting desktop sources:', err)
        })
    } else {
      console.error('[PiPRecorder] window.clipforge.getDesktopSources not available')
    }

    navigator.mediaDevices.enumerateDevices().then(devs => {
      const cameras = devs.filter(d => d.kind === 'videoinput')
      console.log('[PiPRecorder] Found cameras:', cameras.length, cameras)
      setCams(cameras)
      if (cameras.length) setCamId(cameras[0].deviceId)
    }).catch(err => {
      console.error('[PiPRecorder] Error enumerating devices:', err)
    })
  }, [])

  function layoutPip(ctx: CanvasRenderingContext2D, W: number, H: number, pipW: number, pipH: number) {
    const pad = Math.round(Math.min(W,H) * 0.02)
    let x = pad, y = pad
    if (pipCorner.includes('right')) x = W - pipW - pad
    if (pipCorner.includes('bottom')) y = H - pipH - pad
    return { x, y }
  }

  function stopAll() {
    screenStreamRef.current?.getTracks().forEach(t=>t.stop())
    camStreamRef.current?.getTracks().forEach(t=>t.stop())
    micStreamRef.current?.getTracks().forEach(t=>t.stop())
    canvasStreamRef.current?.getTracks().forEach(t=>t.stop())
    
    // Clear external video preview
    if (externalVideoRef?.current) {
      externalVideoRef.current.srcObject = null
    }
    
    screenStreamRef.current = camStreamRef.current = micStreamRef.current = canvasStreamRef.current = null
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    recRef.current = null
  }
  
  // Format duration as MM:SS
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  async function start() {
    console.log('[PiPRecorder] start called, chosen:', chosen?.name, 'camId:', camId)
    if (!chosen) { setStatus('Pick a screen/window'); return }
    if (!camId)  { setStatus('No camera'); return }

    try {
      setStatus('Setting up sources…')
      console.log('[PiPRecorder] Requesting screen capture...')

      // 1) Screen stream (video only)
      const screen = await (navigator.mediaDevices as any).getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: chosen.id,
            maxFrameRate: 30,
            minWidth: 1280, maxWidth: 2560,
            minHeight: 720,  maxHeight: 1440,
          }
        }
      })
      screenStreamRef.current = screen
      if (screenVidRef.current) {
        screenVidRef.current.srcObject = screen
        screenVidRef.current.muted = true
        await screenVidRef.current.play().catch(()=>{})
      }

      // 2) Camera stream (video only)
      const cam = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: camId } }, audio: false
      })
      camStreamRef.current = cam
      if (camVidRef.current) {
        camVidRef.current.srcObject = cam
        camVidRef.current.muted = true
        await camVidRef.current.play().catch(()=>{})
      }

      // 3) Optional mic
      let mic: MediaStream | null = null
      if (includeMic) {
        try { mic = await navigator.mediaDevices.getUserMedia({ audio: true }) } catch {}
      }
      micStreamRef.current = mic

      // 4) Canvas composite
      const canvas = canvasRef.current!
      const sTrack = screen.getVideoTracks()[0]
      // tentative size from screen track settings
      const settings = sTrack.getSettings()
      const baseW = Math.max(1280, settings.width || 1280)
      const baseH = Math.max(720,  settings.height || 720)
      canvas.width = baseW
      canvas.height = baseH

      const ctx = canvas.getContext('2d')!
      const draw = () => {
        const sv = screenVidRef.current!
        const cv = camVidRef.current!
        const W = canvas.width, H = canvas.height

        // draw screen scaled to canvas
        ctx.clearRect(0,0,W,H)
        ctx.drawImage(sv, 0, 0, W, H)

        // compute PiP size by height
        const targetH = Math.round(H * pipScale)
        const aspect = cv.videoWidth > 0 ? (cv.videoWidth / cv.videoHeight) : (16/9)
        const pipW = Math.round(targetH * aspect)
        const pipH = targetH
        const { x, y } = layoutPip(ctx, W, H, pipW, pipH)

        // shadow & rounded rect
        const r = Math.max(8, Math.round(pipW * 0.04))
        ctx.save()
        ctx.shadowColor = 'rgba(0,0,0,0.35)'
        ctx.shadowBlur = 12
        ctx.shadowOffsetY = 2

        // rounded clip
        ctx.beginPath()
        const rr = (x:number,y:number,w:number,h:number,rad:number) => {
          const r2 = Math.min(rad, w/2, h/2)
          ctx.moveTo(x+r2, y)
          ctx.arcTo(x+w, y, x+w, y+h, r2)
          ctx.arcTo(x+w, y+h, x, y+h, r2)
          ctx.arcTo(x, y+h, x, y, r2)
          ctx.arcTo(x, y, x+w, y, r2)
          ctx.closePath()
        }
        rr(x, y, pipW, pipH, r)
        ctx.clip()

        ctx.drawImage(cv, x, y, pipW, pipH)
        ctx.restore()

        rafRef.current = requestAnimationFrame(draw)
      }
      rafRef.current = requestAnimationFrame(draw)

      // 5) Record canvas stream (+ mic audio)
      const canvasStream = canvas.captureStream(30)
      if (mic?.getAudioTracks().length) {
        canvasStream.addTrack(mic.getAudioTracks()[0])
      }
      canvasStreamRef.current = canvasStream

      // 6) Set canvas stream on external video player for preview
      if (externalVideoRef?.current) {
        const preview = externalVideoRef.current
        preview.removeAttribute('src')
        preview.load()
        preview.srcObject = canvasStream
        preview.muted = true
        preview.autoplay = true
        setTimeout(() => {
          preview.play().catch(err => console.error('PiP preview play failed:', err))
        }, 100)
      }

      const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm;codecs=vp8'
      const rec = new MediaRecorder(canvasStream, { mimeType: mime, videoBitsPerSecond: 8_000_000 })
      chunksRef.current = []
      rec.ondataavailable = e => { if (e.data?.size) chunksRef.current.push(e.data) }
      rec.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: mime })
        const bytes = new Uint8Array(await blob.arrayBuffer())
        // @ts-expect-error preload
        const res = await window.clipforge.saveBytes(`pip-${Date.now()}.webm`, bytes)
        if (res.saved && res.path) onRecordingComplete?.(res.path)
        setStatus(res.saved ? 'Saved ✅' : 'Canceled')
        setTimeout(()=>setStatus(''), 1500)
        stopAll()
      }
      rec.start()
      recRef.current = rec
      setRecording(true)
      setIsRecording?.(true)
      setStatus('Recording PiP…')
      
      // Start timer
      startTimeRef.current = Date.now()
      setRecordingDuration(0)
      timerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000)
        setRecordingDuration(elapsed)
      }, 1000)
    } catch (e:any) {
      console.error(e)
      setStatus(e?.message || 'Failed to start PiP — check Screen Recording permission on macOS.')
      stopAll()
    }
  }

  function stop() {
    recRef.current?.stop()
    setRecording(false)
    setIsRecording?.(false)
    setStatus('Finalizing…')
  }

  return (
    <div style={{ padding:10, display:'grid', gap:10 }}>

      {/* Compact header with chosen items */}
      {chosen && camId && (
        <div style={{ padding:8, background:'#f0f9ff', border:'2px solid #2563eb', borderRadius:6, fontSize:12 }}>
          <div><strong>Screen:</strong> {chosen.name}</div>
          <div style={{ marginTop:4 }}>
            <strong>Camera:</strong> {cams.find(c => c.deviceId === camId)?.label || 'Camera'} | 
            <strong> Corner:</strong> {pipCorner} | 
            <strong> Size:</strong> {Math.round(pipScale*100)}%
            <button onClick={() => { setChosen(null); setCamId(null) }} style={{ marginLeft:8, fontSize:11, padding:'2px 6px' }}>Change</button>
          </div>
        </div>
      )}
      
      {/* pickers - only show when not chosen */}
      {(!chosen || !camId) && (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
          {/* screen/window list */}
          <div style={{ border:'1px solid #eee', borderRadius:8, padding:8, background:'#fafafa', maxHeight:120, overflowY:'auto' }}>
            <div style={{ fontSize:12, marginBottom:6 }}>Pick Screen/Window</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, 140px)', gap:6 }}>
              {sources.map(s => (
                <button key={s.id} onClick={()=>setChosen(s)}
                  style={{
                    border: s.id===chosen?.id ? '2px solid #2563eb' : '1px solid #ddd',
                    borderRadius:6, background:'#fff', cursor:'pointer', padding:4, textAlign:'left'
                  }}>
                  {s.thumbnail && s.thumbnail !== 'null' ? (
                    <img 
                      src={s.thumbnail} 
                      alt={s.name} 
                      style={{ width:'100%', height:60, objectFit:'cover', borderRadius:4, display:'block' }}
                      onError={(e) => {
                        console.error('[PiPRecorder] Image load error for', s.name)
                        e.currentTarget.style.display = 'none'
                      }}
                    />
                  ) : (
                    <div style={{ width:'100%', height:60, background:'#333', borderRadius:4, display:'flex', alignItems:'center', justifyContent:'center', color:'#888', fontSize:9 }}>
                      No Preview
                    </div>
                  )}
                  <div style={{ fontSize:10, marginTop:4, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', color:'#111' }}>{s.name}</div>
                </button>
              ))}
            </div>
          </div>

          {/* camera + layout */}
          <div style={{ border:'1px solid #eee', borderRadius:8, padding:8, background:'#fafafa', display:'flex', flexDirection:'column', gap:6 }}>
            <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
              <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                <label style={{ fontSize:11 }}>Camera:</label>
                <select value={camId ?? ''} onChange={e=>setCamId(e.target.value)} style={{ fontSize:11, flex:1 }}>
                  {cams.map(c => <option key={c.deviceId} value={c.deviceId}>{c.label || 'Camera'}</option>)}
                </select>
              </div>
              
              <label style={{ fontSize:11, display:'flex', alignItems:'center', gap:4 }}>
                <input type="checkbox" checked={includeMic} onChange={e=>setIncludeMic(e.target.checked)} /> Mic
              </label>

              <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                  <label style={{ fontSize:11, minWidth:60 }}>Corner:</label>
                  <select value={pipCorner} onChange={e=>setPipCorner(e.target.value as Corner)} style={{ fontSize:11, flex:1 }}>
                    <option value="top-left">Top-left</option>
                    <option value="top-right">Top-right</option>
                    <option value="bottom-left">Bottom-left</option>
                    <option value="bottom-right">Bottom-right</option>
                  </select>
                </div>

                <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                  <label style={{ fontSize:11, minWidth:60 }}>Size:</label>
                  <input type="range" min="0.15" max="0.5" step="0.05"
                    value={pipScale} onChange={e=>setPipScale(parseFloat(e.target.value))}
                    style={{ flex:1 }} />
                  <span style={{ fontSize:11, minWidth:35 }}>{Math.round(pipScale*100)}%</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* controls */}
      <div style={{ display:'flex', gap:8, alignItems:'center' }}>
        {!recording
          ? <button onClick={start} disabled={!chosen || !camId} style={{ padding:'6px 12px', fontSize:13 }}>⏺ Start Recording</button>
          : <button onClick={stop} style={{ padding:'6px 12px', fontSize:13 }}>⏹ Stop & Save</button>}
        <span style={{ fontSize:12, color:'#555', fontWeight:'bold' }}>{status}</span>
      </div>
      
      {/* Recording status and timer */}
      {recording && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 8, background: '#fee', borderRadius: 6 }}>
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

      {/* hidden live video elements (for canvas drawing only) */}
      <div style={{ display:'none' }}>
        <video ref={screenVidRef} muted playsInline />
        <video ref={camVidRef} muted playsInline />
      </div>

      {/* The composite canvas - always rendered but hidden (preview shows in main video player) */}
      <canvas 
        ref={canvasRef}
        style={{ display: 'none' }}
      />
    </div>
  )
}

