// src/renderer/App.tsx
import React, { useEffect, useRef, useState } from 'react'

type Mime = 'video/mp4' | 'video/quicktime' | 'video/webm' | 'video/x-matroska'
const mimeFor = (p: string): Mime => {
  const ext = (p.split('.').pop() || '').toLowerCase()
  if (ext === 'mp4') return 'video/mp4'
  if (ext === 'mov') return 'video/quicktime'
  if (ext === 'webm') return 'video/webm'
  return 'video/x-matroska' // mkv and others
}

export default function App() {
  const [src, setSrc] = useState<string | null>(null)       // blob URL for player
  const [absPath, setAbsPath] = useState<string | null>(null) // real path for ffmpeg
  const [fileName, setFileName] = useState<string>('')
  const [duration, setDuration] = useState(0)
  const [tIn, setTIn] = useState(0)
  const [tOut, setTOut] = useState(0)
  const [working, setWorking] = useState<string>('')

  const videoRef = useRef<HTMLVideoElement>(null)
  const lastBlobUrlRef = useRef<string | null>(null)

  const fmt = (t: number) => {
    const s = Math.max(0, Math.floor(t))
    const hh = String(Math.floor(s / 3600)).padStart(2, '0')
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
    const ss = String(s % 60).padStart(2, '0')
    return `${hh}:${mm}:${ss}`
  }

  const onImport = async () => {
    // @ts-expect-error injected by preload
    if (!window.clipforge?.openVideos) {
      alert('Bridge not available — check preload and sandbox:false')
      return
    }
    const paths: string[] = await window.clipforge.openVideos()
    if (!paths?.length) return
    const p = paths[0]
    setAbsPath(p)
    setFileName(p.split(/[\\/]/).pop() || 'clip.mp4')
    setWorking('Loading video…')

    try {
      // Read bytes via IPC → Blob → object URL (reliable metadata in Electron)
      // @ts-expect-error injected by preload
      const bytes: Uint8Array = await window.clipforge.readFileBytes(p)
      const blob = new Blob([bytes], { type: mimeFor(p) })

      // revoke previous blob url to avoid leaks
      if (lastBlobUrlRef.current) URL.revokeObjectURL(lastBlobUrlRef.current)
      const url = URL.createObjectURL(blob)
      lastBlobUrlRef.current = url
      setSrc(url)

      // reset timing UI while metadata loads
      setDuration(0)
      setTIn(0)
      setTOut(0)
      setWorking('')
    } catch (e) {
      console.error('Failed to read file bytes', e)
      setWorking('Failed to load video ❌')
    }
  }

  // Robust metadata handling (+ fallbacks)
  useEffect(() => {
    const v = videoRef.current
    if (!v || !src) return

    const onMeta = () => {
      let d = Number(v.duration)
      // Some sources report Infinity initially; poke seekable or do a large seek to force duration
      if (!Number.isFinite(d) || d <= 0 || d === Infinity) {
        if (v.seekable && v.seekable.length > 0) {
          d = v.seekable.end(v.seekable.length - 1)
        }
      }
      if (!Number.isFinite(d) || d <= 0 || d === Infinity) {
        // duration trick: jump far ahead and back to resolve duration
        const back = v.currentTime
        v.currentTime = 1e6
        v.onseeked = () => {
          const dd = Number(v.duration)
          v.currentTime = back
          v.onseeked = null
          if (Number.isFinite(dd) && dd > 0 && dd !== Infinity) {
            setDuration(dd)
            setTIn(0)
            setTOut(Math.max(0.05, dd - 0.05))
          }
        }
      } else {
        setDuration(d)
        setTIn(0)
        setTOut(Math.max(0.05, d - 0.05))
      }
    }

    const onError = () => {
      console.error('video error', v.error)
      setWorking('Video failed to load ❌')
    }

    v.addEventListener('loadedmetadata', onMeta)
    v.addEventListener('durationchange', onMeta)
    v.addEventListener('error', onError)
    // kick metadata loading
    v.load()

    return () => {
      v.removeEventListener('loadedmetadata', onMeta)
      v.removeEventListener('durationchange', onMeta)
      v.removeEventListener('error', onError)
    }
  }, [src])

  useEffect(() => {
    return () => {
      if (lastBlobUrlRef.current) URL.revokeObjectURL(lastBlobUrlRef.current)
    }
  }, [])

  const exportTrim = async () => {
    if (!absPath) return
    if (!(duration > 0) || !(tOut > tIn + 0.02)) {
      setWorking('Pick a non-zero range first')
      setTimeout(() => setWorking(''), 1200)
      return
    }
    setWorking('Transcoding with FFmpeg…')
    try {
      // @ts-expect-error exposed by preload
      const bytes: Uint8Array = await window.clipforge.ffmpegTrim(absPath, tIn, tOut, true)
      const suggested = fileName.replace(/\.[^.]+$/, '') + `.trim.mp4`
      // @ts-expect-error exposed by preload
      const res = await window.clipforge.saveBytes(suggested, bytes)
      setWorking(res.saved ? 'Exported ✅' : 'Canceled')
    } catch (e) {
      console.error(e)
      setWorking('Export failed ❌')
    } finally {
      setTimeout(() => setWorking(''), 1500)
    }
  }

  // Clamp helpers so min < max always
  const inMax  = duration > 0 ? Math.max(0.01, (tOut || 0.02) - 0.01) : 0.01
  const outMin = duration > 0 ? Math.min(Math.max(0.02, tIn + 0.01), duration || 0.02) : 0.02

  return (
    <div>
      <div className="toolbar">
        <button onClick={onImport}>➕ Import</button>
        <button onClick={exportTrim} disabled={!src || !(duration > 0) || !(tOut > tIn + 0.02)}>
          💾 Export MP4
        </button>
        <span className="meta">{working}</span>
      </div>

      <div className="main">
        <div className="player">
          {src ? (
            <video
              ref={videoRef}
              src={src}
              preload="metadata"
              controls
              style={{ width: '100%', height: '100%' }}
            />
          ) : (
            <div style={{ color: '#444', padding: 24 }}>
              <h1>ClipForge</h1>
              <p>Import a video to get started.</p>
            </div>
          )}
        </div>

        <div className="controls">
          <div className="meta">
            {src
              ? <>File: <b>{fileName}</b> • Duration: <b>{duration > 0 ? fmt(duration) : 'loading…'}</b></>
              : '—'}
          </div>

          {src && duration > 0 && (
            <>
              <div className="range">
                <label style={{ width: 80 }}>In {fmt(tIn)}</label>
                <input
                  type="range"
                  min={0}
                  max={inMax}
                  step={0.01}
                  value={Math.min(tIn, inMax)}
                  onChange={e => setTIn(Math.min(Number(e.target.value), inMax))}
                  style={{ flex: 1 }}
                />
              </div>
              <div className="range">
                <label style={{ width: 80 }}>Out {fmt(tOut)}</label>
                <input
                  type="range"
                  min={outMin}
                  max={duration}
                  step={0.01}
                  value={Math.max(tOut, outMin)}
                  onChange={e => setTOut(Math.max(Number(e.target.value), outMin))}
                  style={{ flex: 1 }}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

