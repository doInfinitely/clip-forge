// src/renderer/App.tsx
import React, { useEffect, useRef, useState } from 'react'
import TimelineCanvas, { Clip } from './components/TimelineCanvas'
import RecordingPanel from './components/RecordingPanel'
import { nanoid } from 'nanoid'

type Mime = 'video/mp4' | 'video/quicktime' | 'video/webm' | 'video/x-matroska'
const mimeFor = (p: string): Mime => {
  const ext = (p.split('.').pop() || '').toLowerCase()
  if (ext === 'mp4') return 'video/mp4'
  if (ext === 'mov') return 'video/quicktime'
  if (ext === 'webm') return 'video/webm'
  if (ext === 'mkv') return 'video/x-matroska'
  return 'video/webm' // default to webm for recordings
}

// simple distinct colors
const COLORS = ['#93c5fd','#86efac','#fbcfe8','#fde68a','#c7d2fe','#fed7aa','#a7f3d0','#fca5a5']

export default function App() {
  // video preview of the *selected* clip
  const [src, setSrc] = useState<string | null>(null)     // blob URL for player
  const [fileName, setFileName] = useState<string>('')
  const [working, setWorking] = useState<string>('')
  const [progress, setProgress] = useState<string>('')

  // timeline data
  const [clips, setClips] = useState<Clip[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pxPerSec, setPxPerSec] = useState(() => {
    const saved = localStorage.getItem('clipforge_pxPerSec')
    return saved ? Number(saved) : 80
  })

  // absolute playhead time across the sequence
  const [absTime, setAbsTime] = useState(0)
  const [isRecording, setIsRecording] = useState(false)

  // Export resolution preset
  type ResPreset = 'source' | '720p' | '1080p'
  const [timelineRes, setTimelineRes] = useState<ResPreset>('source')

  const videoRef = useRef<HTMLVideoElement>(null)
  const lastBlobUrlRef = useRef<string | null>(null)
  const playThroughRef = useRef(false)  // when true, auto-play after switching clips
  
  // Wrapped setAbsTime that marks it as a user action from timeline
  const setAbsTimeFromUser = (t: number) => {
    // Pause the video when clicking timeline to prevent auto-play
    const v = videoRef.current
    if (v && !v.paused) {
      v.pause()
    }
    setAbsTime(t)
  }

  // Listen to FFmpeg progress updates
  useEffect(() => {
    // @ts-expect-error preload
    if (window.clipforge?.onFFmpegProgress) {
      // @ts-expect-error preload
      window.clipforge.onFFmpegProgress((message: string) => {
        setProgress(message)
      })
    }
  }, [])

  // Load project on mount
  useEffect(() => {
    // @ts-expect-error preload
    if (window.clipforge?.projectLoad) {
      // @ts-expect-error preload
      window.clipforge.projectLoad()?.then((p: any) => {
        if (p?.clips) setClips(p.clips)
        if (p?.pxPerSec) setPxPerSec(p.pxPerSec)
      })
    }
  }, [])

  // Save zoom level to localStorage
  useEffect(() => {
    localStorage.setItem('clipforge_pxPerSec', String(pxPerSec))
  }, [pxPerSec])

  // Autosave project when clips or zoom changes
  useEffect(() => {
    const payload = { clips, pxPerSec }
    // best-effort debounce-ish save
    const t = setTimeout(() => {
      // @ts-expect-error preload
      if (window.clipforge?.projectSave) {
        // @ts-expect-error preload
        window.clipforge.projectSave(payload)
      }
    }, 400)
    return () => clearTimeout(t)
  }, [clips, pxPerSec])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Space = play/pause
      if (e.code === 'Space' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        const v = videoRef.current
        if (v) {
          if (v.paused) v.play().catch(() => {})
          else v.pause()
        }
        return
      }

      // [ = nudge In by -0.05s
      if (e.key === '[' && selectedId) {
        e.preventDefault()
        setClips(prev => prev.map(c => {
          if (c.id !== selectedId) return c
          const newIn = Math.max(0, c.in - 0.05)
          return { ...c, in: Math.min(newIn, c.out - 0.05) }
        }))
        return
      }

      // ] = nudge Out by +0.05s
      if (e.key === ']' && selectedId) {
        e.preventDefault()
        setClips(prev => prev.map(c => {
          if (c.id !== selectedId) return c
          const newOut = Math.min(c.duration, c.out + 0.05)
          return { ...c, out: Math.max(newOut, c.in + 0.05) }
        }))
        return
      }

      // Backspace = delete selected
      if (e.key === 'Backspace' && selectedId) {
        e.preventDefault()
        deleteSelected()
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedId, clips]) // eslint-disable-line react-hooks/exhaustive-deps

  // derive selected clip + local time mapping
  const sequenceSpans = (() => {
    let acc = 0
    const arr = clips.map(c => {
      const len = Math.max(0.05, c.out - c.in)
      const start = acc
      acc += len
      return { id: c.id, start, len, clip: c }
    })
    return { arr, total: acc }
  })()

  const selectedClip = clips.find(c => c.id === selectedId) || null

  // absTime -> selected clip & local time for the video element
  // Only auto-select when there's no current selection
  useEffect(() => {
    if (sequenceSpans.arr.length === 0) return
    // if no selection, pick the block at absTime
    if (!selectedClip) {
      let acc = 0
      for (const b of sequenceSpans.arr) {
        if (absTime >= acc && absTime <= acc + b.len + 1e-6) {
          setSelectedId(b.id)
          break
        }
        acc += b.len
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [absTime, sequenceSpans.total])

  // Load preview whenever the selection changes
  useEffect(() => {
    const c = selectedClip
    if (!c) {
      // Clear video when no clips
      if (lastBlobUrlRef.current) {
        URL.revokeObjectURL(lastBlobUrlRef.current)
        lastBlobUrlRef.current = null
      }
      setSrc(null)
      setFileName('')
      return
    }
    
    ;(async () => {
      try {
        // @ts-expect-error preload
        const bytes: Uint8Array = await window.clipforge.readFileBytes(c.path)
        const blob = new Blob([bytes], { type: mimeFor(c.path) })
        if (lastBlobUrlRef.current) URL.revokeObjectURL(lastBlobUrlRef.current)
        const url = URL.createObjectURL(blob)
        lastBlobUrlRef.current = url
        setSrc(url)
        setFileName(c.name)
      } catch (e) {
        console.error('Failed to load preview for selection', e)
      }
    })()
    return () => {}
  }, [selectedId]) // eslint-disable-line react-hooks/exhaustive-deps

  // When video metadata loads, seek to the local time that matches absTime
  useEffect(() => {
    const v = videoRef.current
    if (!v || !selectedClip) return

    const onMeta = () => {
      // compute local time within selected clip
      const startAbs = sequenceSpans.arr.find(b => b.id === selectedClip.id)?.start ?? 0
      const local = selectedClip.in + Math.max(0, absTime - startAbs)
      if (Number.isFinite(local)) {
        try { 
          v.currentTime = Math.min(Math.max(0, local), selectedClip.out - 0.001)
        } catch {}
      }
    }

    v.addEventListener('loadedmetadata', onMeta)
    v.addEventListener('durationchange', onMeta)
    return () => {
      v.removeEventListener('loadedmetadata', onMeta)
      v.removeEventListener('durationchange', onMeta)
    }
  }, [src, absTime, selectedClip, sequenceSpans.arr])

  // Auto-resume playback after clip switch (separate effect for clarity)
  useEffect(() => {
    const v = videoRef.current
    if (!v || !selectedClip || !src) return

    // Only auto-play if we explicitly set playThroughRef (during auto-advance)
    if (playThroughRef.current) {
      console.log('[Auto-resume] Starting auto-resume for:', selectedClip.name)
      playThroughRef.current = false
      
      // Multiple strategies to ensure playback resumes
      const attemptPlay = () => {
        if (!v) return
        console.log('[Auto-resume] Attempting play, readyState:', v.readyState, 'paused:', v.paused)
        const playPromise = v.play()
        if (playPromise !== undefined) {
          playPromise
            .then(() => console.log('[Auto-resume] Play succeeded'))
            .catch(err => console.error('[Auto-resume] Play failed:', err))
        }
      }
      
      // Strategy 1: Try with a small delay to let DOM settle
      setTimeout(() => {
        if (v.readyState >= 2) {
          console.log('[Auto-resume] Video ready, playing after delay')
          attemptPlay()
        }
      }, 50)
      
      // Strategy 2: Listen for loadedmetadata
      const onLoaded = () => {
        console.log('[Auto-resume] loadedmetadata fired')
        v.removeEventListener('loadedmetadata', onLoaded)
        setTimeout(attemptPlay, 50)
      }
      v.addEventListener('loadedmetadata', onLoaded)
      
      // Strategy 3: Listen for canplay as backup
      const onCanPlay = () => {
        console.log('[Auto-resume] canplay fired')
        v.removeEventListener('canplay', onCanPlay)
        setTimeout(attemptPlay, 50)
      }
      v.addEventListener('canplay', onCanPlay)
      
      // Cleanup after 3 seconds
      const cleanup = setTimeout(() => {
        v.removeEventListener('loadedmetadata', onLoaded)
        v.removeEventListener('canplay', onCanPlay)
      }, 3000)
      
      return () => {
        clearTimeout(cleanup)
        v.removeEventListener('loadedmetadata', onLoaded)
        v.removeEventListener('canplay', onCanPlay)
      }
    }
  }, [selectedClip, src])

  // Seek video when absTime changes (scrubbing) - only when paused
  useEffect(() => {
    const v = videoRef.current
    if (!v || !selectedClip || !v.duration || !Number.isFinite(v.duration)) return
    
    // Don't seek while video is playing - that causes stuttering
    if (!v.paused) return
    
    // compute local time within selected clip
    const startAbs = sequenceSpans.arr.find(b => b.id === selectedClip.id)?.start ?? 0
    const local = selectedClip.in + Math.max(0, absTime - startAbs)
    if (Number.isFinite(local)) {
      const targetTime = Math.min(Math.max(0, local), selectedClip.out - 0.001)
      // Only seek if difference is significant
      if (Math.abs(v.currentTime - targetTime) > 0.05) {
        try { 
          v.currentTime = targetTime
        } catch {}
      }
    }
  }, [absTime, selectedClip, sequenceSpans.arr])

  // Scrub video → update absTime (ONLY when video is playing)
  useEffect(() => {
    const v = videoRef.current
    if (!v || !selectedClip) return
    
    const tick = () => {
      // ONLY update absTime when video is actually playing
      // This prevents timeupdate from overwriting user clicks/seeks
      if (v.paused) return
      
      // Calculate absTime from video's current time
      const startAbs = sequenceSpans.arr.find(b => b.id === selectedClip.id)?.start ?? 0
      const local = v.currentTime
      const calculatedAbs = startAbs + Math.max(0, local - selectedClip.in)
      setAbsTime(calculatedAbs)

      // Auto-advance when we hit the clip's out
      const epsilon = 0.15 // ~4-5 frames for better detection
      if (local >= (selectedClip.out - epsilon)) {
        console.log('[Auto-advance] Boundary reached, advancing to next clip')
        // find next block
        const idx = sequenceSpans.arr.findIndex(b => b.id === selectedClip.id)
        const next = sequenceSpans.arr[idx + 1]
        if (next) {
          console.log('[Auto-advance] Next clip:', next.clip.name, 'Setting playThroughRef=true')
          // Mark that we should continue playing after clip switch
          playThroughRef.current = true
          // Pause to prevent looping at boundary
          v.pause()
          // Switch to next clip
          setSelectedId(next.id)
          setAbsTime(next.start)
        } else {
          // no next clip -> stop
          v.pause()
        }
      }
    }
    
    v.addEventListener('timeupdate', tick)
    return () => { 
      v.removeEventListener('timeupdate', tick)
    }
  }, [selectedClip, sequenceSpans.arr])

  // Import: add one clip at a time (you can loop over paths to add many)
  const onImport = async () => {
    // @ts-expect-error preload
    if (!window.clipforge?.openVideos) {
      alert('Bridge not available — check preload and sandbox:false')
      return
    }
    const paths: string[] = await window.clipforge.openVideos()
    if (!paths?.length) return
    const p = paths[0]
    const id = nanoid(8)
    const name = (p.split(/[\\/]/).pop() || 'clip')
    const color = COLORS[(clips.length) % COLORS.length]

    // Probe duration and resolution by loading into a temp <video> in memory:
    const meta = await probeMedia(p)

    const next: Clip = {
      id, name, path: p,
      in: 0,
      out: Math.max(0.05, meta.duration || 1),
      duration: meta.duration || 1,
      color,
      width: meta.width,
      height: meta.height,
    }
    setClips(prev => [...prev, next])
    setSelectedId(id)

    // Set absTime to end so subsequent imports appear after
    const total = sequenceSpans.total + (next.out - next.in)
    setAbsTime(total)
  }

  // Probe media metadata (duration + resolution) by reading bytes and loading a blob URL
  const probeMedia = async (path: string): Promise<{ duration: number; width?: number; height?: number }> => {
    try {
      // @ts-expect-error preload
      const bytes: Uint8Array = await window.clipforge.readFileBytes(path)
      const blob = new Blob([bytes], { type: mimeFor(path) })
      const url = URL.createObjectURL(blob)
      const v = document.createElement('video')
      v.preload = 'metadata'
      return await new Promise((resolve) => {
        let done = false
        const cleanup = () => { if (!done) { done = true; URL.revokeObjectURL(url) } }
        const to = setTimeout(() => { cleanup(); resolve({ duration: 0 }) }, 10000)
        v.onloadedmetadata = () => {
          clearTimeout(to)
          const d = Number(v.duration)
          const width = v.videoWidth || undefined
          const height = v.videoHeight || undefined
          cleanup()
          resolve({ duration: (Number.isFinite(d) && d > 0) ? d : 0, width, height })
        }
        v.onerror = () => { clearTimeout(to); cleanup(); resolve({ duration: 0 }) }
        v.src = url
      })
    } catch {
      return { duration: 0 }
    }
  }

  // Handle completed screen recording
  const handleRecordingComplete = async (filePath: string) => {
    console.log('[handleRecordingComplete] Processing:', filePath)
    const id = nanoid(8)
    const name = (filePath.split(/[\\/]/).pop() || 'recording.webm')
    const color = COLORS[(clips.length) % COLORS.length]

    // Calculate where new clip will start
    const currentTotal = sequenceSpans.total

    // Probe duration and resolution - wait for file to be fully written and closed
    console.log('[handleRecordingComplete] Waiting 1s for file to be written...')
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    let meta = await probeMedia(filePath)
    console.log('[handleRecordingComplete] First probe result:', meta)
    
    // If duration probe failed, try again with longer delay
    if (meta.duration < 0.5) {
      console.log('[handleRecordingComplete] Duration too small, retrying in 2s...')
      await new Promise(resolve => setTimeout(resolve, 2000))
      meta = await probeMedia(filePath)
      console.log('[handleRecordingComplete] Second probe result:', meta)
    }

    // If still failed, try one more time
    if (meta.duration < 0.5) {
      console.log('[handleRecordingComplete] Still too small, final retry in 2s...')
      await new Promise(resolve => setTimeout(resolve, 2000))
      meta = await probeMedia(filePath)
      console.log('[handleRecordingComplete] Final probe result:', meta)
    }

    // Ensure minimum duration of 5 seconds if probe failed
    const finalDuration = meta.duration > 0.5 ? meta.duration : 5
    console.log('[handleRecordingComplete] Using duration:', finalDuration)

    const next: Clip = {
      id, name, path: filePath,
      in: 0,
      out: finalDuration,
      duration: finalDuration,
      color,
      width: meta.width,
      height: meta.height,
    }
    
    console.log('[handleRecordingComplete] Adding clip:', next)
    setClips(prev => [...prev, next])
    setSelectedId(id)

    // Set absTime to start of new clip (using the total we calculated before adding)
    setAbsTime(currentTotal)
  }

  // Export selected clip’s In/Out (existing MVP path)
  const exportSelected = async () => {
    const sel = selectedClip
    if (!sel) return
    const rangeOk = sel.out > sel.in + 0.02
    if (!rangeOk) {
      setWorking('Pick a non-zero range first')
      setTimeout(() => setWorking(''), 1200)
      return
    }
    setWorking('Transcoding with FFmpeg…')
    try {
      // @ts-expect-error from preload
      const bytes: Uint8Array = await window.clipforge.ffmpegTrim(sel.path, sel.in, sel.out, true)
      const suggested = sel.name.replace(/\.[^.]+$/, '') + `.trim.mp4`
      // @ts-expect-error from preload
      const res = await window.clipforge.saveBytes(suggested, bytes)
      setWorking(res.saved ? 'Exported ✅' : 'Canceled')
    } catch (e) {
      console.error(e)
      setWorking('Export failed ❌')
    } finally {
      setTimeout(() => setWorking(''), 1500)
    }
  }

  // Reorder by dropping a block at an index
  const onReorder = (fromId: string, toIndex: number) => {
    setClips(prev => {
      const idx = prev.findIndex(c => c.id === fromId)
      if (idx < 0) return prev
      const arr = prev.slice()
      const [it] = arr.splice(idx, 1)
      const clamped = Math.max(0, Math.min(arr.length, toIndex))
      arr.splice(clamped, 0, it)
      return arr
    })
  }

  // Trim adjust
  const onTrim = (id: string, which: 'in' | 'out', next: number) => {
    setClips(prev => prev.map(c => {
      if (c.id !== id) return c
      if (which === 'in') {
        const nin = Math.max(0, Math.min(next, c.out - 0.05))
        return { ...c, in: nin }
      } else {
        const nout = Math.min(c.duration, Math.max(next, c.in + 0.05))
        return { ...c, out: nout }
      }
    }))
  }

  // Split at playhead
  const splitAtPlayhead = () => {
    if (!selectedId) return
    const idx = clips.findIndex(c => c.id === selectedId)
    if (idx < 0) return
    const c = clips[idx]
    const startAbs = sequenceSpans.arr.find(b => b.id === c.id)?.start ?? 0
    const local = c.in + Math.max(0, absTime - startAbs)
    if (local <= c.in + 0.05 || local >= c.out - 0.05) return // too close, skip

    const left = { ...c, id: nanoid(8), out: local }
    const right = { ...c, id: nanoid(8), in: local, name: c.name + ' (2)' }
    setClips(prev => prev.toSpliced(idx, 1, left, right))
    setSelectedId(right.id)
  }

  // Delete selected
  const deleteSelected = () => {
    if (!selectedId) return
    
    // Pause video and clear source if deleting the currently playing clip
    const v = videoRef.current
    if (v) {
      v.pause()
    }
    
    const newClips = clips.filter(c => c.id !== selectedId)
    setClips(newClips)
    setSelectedId(null)
    
    // If no clips left, clear the video
    if (newClips.length === 0) {
      if (src) {
        URL.revokeObjectURL(src)
      }
      setSrc(null)
      setFileName('')
    }
  }

  // Export timeline (multi-clip)
  const exportTimeline = async () => {
    if (!clips.length) return
    setWorking('Rendering timeline…')
    setProgress('')
    try {
      const parts = sequenceSpans.arr.map(b => ({
        inputPath: b.clip.path,
        tIn: b.clip.in,
        tOut: b.clip.out,
      }))

      const targetHeight =
        timelineRes === '720p' ? 720 :
        timelineRes === '1080p' ? 1080 :
        0 // 0 = source (no scaling)

      // @ts-expect-error preload
      const bytes: Uint8Array = await window.clipforge.exportTimeline(parts, 22, targetHeight)
      const suggested = 'timeline_export.mp4'
      // @ts-expect-error preload
      const res = await window.clipforge.saveBytes(suggested, bytes)
      setWorking(res.saved ? 'Exported ✅' : 'Canceled')
      setProgress('')
    } catch (e) {
      console.error(e)
      setWorking('Export failed ❌')
      setProgress('')
    } finally {
      setTimeout(() => { setWorking(''); setProgress('') }, 1500)
    }
  }

  return (
    <div>
      <div className="toolbar">
        <button onClick={onImport}>➕ Import</button>
        <button onClick={splitAtPlayhead} disabled={!selectedId}>✂️ Split</button>
        <button onClick={deleteSelected} disabled={!selectedId}>🗑️ Delete</button>
        
        {/* Resolution preset for export */}
        <label className="meta" style={{ marginLeft: 8 }}>
          Export res:{' '}
          <select
            value={timelineRes}
            onChange={e => setTimelineRes(e.target.value as ResPreset)}
            style={{ fontSize: 12 }}
          >
            <option value="source">Source</option>
            <option value="720p">720p</option>
            <option value="1080p">1080p</option>
          </select>
        </label>
        
        <button onClick={exportSelected} disabled={!selectedClip}>💾 Export MP4 (selected)</button>
        <button onClick={exportTimeline} disabled={!clips.length}>📤 Export Timeline</button>
        <span className="meta">{working}</span>
      </div>

      <div className="main">
        <div className="player">
          <video
            ref={videoRef}
            src={src || undefined}
            controls
            muted={isRecording}
            playsInline
            style={{ 
              display: src || isRecording ? 'block' : 'none',
              width: '100%',
              height: 'auto'
            }}
          />
          {!src && !isRecording && (
            <div style={{ color: '#444', padding: 24 }}>
              <h1>ClipForge</h1>
              <p>Import a video to get started.</p>
            </div>
          )}
        </div>

        {/* Timeline */}
        <div className="timeline">
          <div className="timelineHeader">
            <b>Timeline</b>
            <button onClick={() => setPxPerSec(v => Math.max(10, Math.floor(v * 0.8)))} style={{ padding:'2px 6px' }}>–</button>
            <button onClick={() => setPxPerSec(v => Math.min(800, Math.ceil(v * 1.25)))} style={{ padding:'2px 6px' }}>+</button>
            <span style={{ color:'#666' }}>{Math.round(pxPerSec)} px/s</span>
          </div>

          <div className="timelineWrap">
            <TimelineCanvas
              clips={clips}
              selectedId={selectedId}
              setSelectedId={setSelectedId}
              pxPerSec={pxPerSec}
              setPxPerSec={setPxPerSec}
              absTime={absTime}
              setAbsTime={setAbsTimeFromUser}
              onReorder={onReorder}
              onTrim={onTrim}
            />
          </div>
        </div>

        {/* Recording Panel (Tabbed) */}
        <RecordingPanel 
          onRecordingComplete={handleRecordingComplete}
          videoRef={videoRef}
          setIsRecording={setIsRecording}
        />
      </div>
      {progress && (
        <div style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          background: 'rgba(0,0,0,0.8)',
          color: '#fff',
          padding: '8px 16px',
          fontSize: '11px',
          fontFamily: 'monospace',
          zIndex: 1000
        }}>
          {progress}
        </div>
      )}
    </div>
  )
}

