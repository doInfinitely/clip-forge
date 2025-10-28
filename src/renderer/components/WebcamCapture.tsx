import React, { useEffect, useRef, useState } from 'react'

type Props = {
  onRecordingComplete?: (filePath: string) => void
  videoRef?: React.RefObject<HTMLVideoElement>
  setIsRecording?: (recording: boolean) => void
}

export default function WebcamCapture({ onRecordingComplete, videoRef: externalVideoRef, setIsRecording }: Props) {
  const [cams, setCams] = useState<MediaDeviceInfo[]>([])
  const [camId, setCamId] = useState<string | null>(null)
  const [includeMic, setIncludeMic] = useState(true)
  const [recording, setRecording] = useState(false)
  const [status, setStatus] = useState('')
  const [recordingDuration, setRecordingDuration] = useState(0)

  const videoRef = useRef<HTMLVideoElement>(null)
  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const startTimeRef = useRef<number>(0)

  useEffect(() => {
    (async () => {
      console.log('[WebcamCapture] Enumerating devices...')
      const devices = await navigator.mediaDevices.enumerateDevices()
      const cameras = devices.filter(d => d.kind === 'videoinput')
      console.log('[WebcamCapture] Found cameras:', cameras.length, cameras)
      setCams(cameras)
      if (cameras.length && !camId) setCamId(cameras[0].deviceId)
    })().catch(err => {
      console.error('[WebcamCapture] Error enumerating devices:', err)
    })
  }, [])

  async function start() {
    try {
      setStatus('Starting webcam…')
      const video = await navigator.mediaDevices.getUserMedia({
        video: camId ? { deviceId: { exact: camId } } : true,
        audio: false
      })
      let mic: MediaStream | null = null
      if (includeMic) {
        try { mic = await navigator.mediaDevices.getUserMedia({ audio: true }) } catch {}
      }
      const mixed = new MediaStream([
        ...video.getVideoTracks(),
        ...(mic ? mic.getAudioTracks() : []),
      ])
      streamRef.current = mixed

      // Use external video ref if provided, otherwise use local
      const preview = externalVideoRef?.current || videoRef.current
      if (preview) {
        preview.removeAttribute('src')
        preview.load()
        preview.srcObject = mixed
        preview.muted = true
        preview.autoplay = true
        setTimeout(() => {
          preview.play().catch(err => console.error('Webcam preview play failed:', err))
        }, 100)
      }

      const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm;codecs=vp8'
      const rec = new MediaRecorder(mixed, { mimeType: mime, videoBitsPerSecond: 6_000_000 })
      chunksRef.current = []
      rec.ondataavailable = e => { if (e.data?.size) chunksRef.current.push(e.data) }
      rec.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: mime })
        const bytes = new Uint8Array(await blob.arrayBuffer())
        // @ts-expect-error preload
        const res = await window.clipforge.saveBytes(`webcam-${Date.now()}.webm`, bytes)
        if (res.saved && res.path) onRecordingComplete?.(res.path)
        setStatus(res.saved ? 'Saved ✅' : 'Canceled')
        setTimeout(()=>setStatus(''), 1500)
      }
      rec.start()
      recRef.current = rec
      setRecording(true)
      setIsRecording?.(true)
      setStatus('') // Clear status - the red banner will show recording state
      
      // Start timer
      startTimeRef.current = Date.now()
      setRecordingDuration(0)
      timerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000)
        setRecordingDuration(elapsed)
      }, 1000)
    } catch (e:any) {
      console.error(e); setStatus(e?.message || 'Failed to start webcam')
    }
  }

  function stop() {
    // Stop recording first
    recRef.current?.stop()
    
    // Immediately stop all tracks to prevent feedback
    streamRef.current?.getTracks().forEach(t => t.stop())
    
    // Clear preview immediately
    const preview = externalVideoRef?.current || videoRef.current
    if (preview) {
      preview.srcObject = null
      preview.pause()
    }
    
    // Stop timer
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    
    recRef.current = null
    streamRef.current = null
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
    <div style={{ padding:10, display:'grid', gap:8 }}>
      {cams.length === 0 && (
        <div style={{ fontSize:12, color:'#666', padding:'8px', background:'#fff3cd', borderRadius:4 }}>
          Loading cameras... (You may need to grant camera permission)
        </div>
      )}
      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
        <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
          <label style={{ fontSize:13 }}>Camera:</label>
          <select value={camId ?? ''} onChange={e=>setCamId(e.target.value)} style={{ fontSize:13, padding:'4px 8px' }}>
            {cams.length === 0 && <option value="">No cameras found</option>}
            {cams.map(c => <option key={c.deviceId} value={c.deviceId}>{c.label || `Camera ${c.deviceId.slice(0,8)}`}</option>)}
          </select>
          <label style={{ fontSize:13 }}>
            <input type="checkbox" checked={includeMic} onChange={e=>setIncludeMic(e.target.checked)} /> Mic
          </label>
        </div>
        
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          {!recording
            ? <button onClick={start} disabled={!camId} style={{ padding:'6px 12px', fontSize:13 }}>⏺ Start Recording</button>
            : <button onClick={stop} style={{ padding:'6px 12px', fontSize:13 }}>⏹ Stop & Save</button>}
          <span style={{ fontSize:12, color:'#555', fontWeight:'bold' }}>{status}</span>
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
      {/* Only show local preview if no external video ref */}
      {!externalVideoRef && recording && (
        <video ref={videoRef} autoPlay muted playsInline style={{ width:'100%', maxHeight:180, background:'#000', borderRadius:8, border:'2px solid #2563eb' }} />
      )}
      {!externalVideoRef && !recording && (
        <div style={{ width:'100%', height:180, background:'#1a1a1a', borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center', color:'#666' }}>
          Click "Start Webcam" to begin recording
        </div>
      )}
    </div>
  )
}

