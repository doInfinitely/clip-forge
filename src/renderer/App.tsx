// src/renderer/App.tsx
import React, { useEffect, useRef, useState } from 'react'
import TimelineCanvas, { Clip } from './components/TimelineCanvas'
import { nanoid } from 'nanoid'

type Mime = 'video/mp4' | 'video/quicktime' | 'video/webm' | 'video/x-matroska'
const mimeFor = (p: string): Mime => {
  const ext = (p.split('.').pop() || '').toLowerCase()
  if (ext === 'mp4') return 'video/mp4'
  if (ext === 'mov') return 'video/quicktime'
  if (ext === 'webm') return 'video/webm'
  return 'video/x-matroska'
}

// simple distinct colors
const COLORS = ['#93c5fd','#86efac','#fbcfe8','#fde68a','#c7d2fe','#fed7aa','#a7f3d0','#fca5a5']

export default function App() {
  // video preview of the *selected* clip
  const [src, setSrc] = useState<string | null>(null)     // blob URL for player
  const [fileName, setFileName] = useState<string>('')
  const [working, setWorking] = useState<string>('')

  // timeline data
  const [clips, setClips] = useState<Clip[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pxPerSec, setPxPerSec] = useState(120)

  // absolute playhead time across the sequence
  const [absTime, setAbsTime] = useState(0)

  const videoRef = useRef<HTMLVideoElement>(null)
  const lastBlobUrlRef = useRef<string | null>(null)

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
    if (!c) return
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
        try { v.currentTime = Math.min(Math.max(0, local), selectedClip.out - 0.001) } catch {}
      }
    }

    v.addEventListener('loadedmetadata', onMeta)
    v.addEventListener('durationchange', onMeta)
    return () => {
      v.removeEventListener('loadedmetadata', onMeta)
      v.removeEventListener('durationchange', onMeta)
    }
  }, [src, absTime, selectedClip, sequenceSpans.arr])

  // Scrub video → update absTime
  useEffect(() => {
    const v = videoRef.current
    if (!v || !selectedClip) return
    const tick = () => {
      // local time in selected clip
      const startAbs = sequenceSpans.arr.find(b => b.id === selectedClip.id)?.start ?? 0
      const local = v.currentTime
      const nextAbs = startAbs + Math.max(0, local - selectedClip.in)
      setAbsTime(nextAbs)
    }
    const onTime = () => tick()
    v.addEventListener('timeupdate', onTime)
    return () => { v.removeEventListener('timeupdate', onTime) }
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

    // Probe duration by loading into a temp <video> in memory:
    const duration = await probeDuration(p)

    const next: Clip = {
      id, name, path: p,
      in: 0,
      out: Math.max(0.05, duration || 1),
      duration: duration || 1,
      color,
    }
    setClips(prev => [...prev, next])
    setSelectedId(id)

    // Set absTime to end so subsequent imports appear after
    const total = sequenceSpans.total + (next.out - next.in)
    setAbsTime(total)
  }

  // Probe duration by reading bytes and loading a blob URL
  const probeDuration = async (path: string) => {
    try {
      // @ts-expect-error preload
      const bytes: Uint8Array = await window.clipforge.readFileBytes(path)
      const blob = new Blob([bytes], { type: mimeFor(path) })
      const url = URL.createObjectURL(blob)
      const v = document.createElement('video')
      v.preload = 'metadata'
      return await new Promise<number>((resolve) => {
        const cleanup = () => { URL.revokeObjectURL(url) }
        v.onloadedmetadata = () => { const d = Number(v.duration); cleanup(); resolve(Number.isFinite(d) ? d : 0) }
        v.onerror = () => { cleanup(); resolve(0) }
        v.src = url
      })
    } catch {
      return 0
    }
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

  return (
    <div>
      <div className="toolbar">
        <button onClick={onImport}>➕ Import</button>
        <button onClick={exportSelected} disabled={!selectedClip}>💾 Export MP4 (selected)</button>
        <span className="meta">{working}</span>
      </div>

      <div className="main">
        <div className="player">
          {src ? (
            <video
              ref={videoRef}
              src={src}
              controls
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'contain',   // ← keep full frame visible
                background: '#000'      // ← avoid gray bars
              }}
            />
          ) : (
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
              setSelectedId={(id) => {
                setSelectedId(id)
                const b = sequenceSpans.arr.find(x => x.id === id)
                if (b) setAbsTime(b.start)
              }}
              pxPerSec={pxPerSec}
              setPxPerSec={setPxPerSec}
              absTime={absTime}
              setAbsTime={setAbsTime}
              onReorder={onReorder}
              onTrim={onTrim}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

