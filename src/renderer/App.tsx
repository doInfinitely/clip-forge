// src/renderer/App.tsx
import React, { useEffect, useRef, useState } from 'react'
import TimelineCanvas, { Clip } from './components/TimelineCanvas'
import RecordingPanel from './components/RecordingPanel'
import MediaLibrary from './components/MediaLibrary'
import Settings from './components/Settings'
import { nanoid } from 'nanoid'

type LibraryItem = {
  id: string
  name: string
  path: string
  duration: number
  width?: number
  height?: number
  thumb?: string  // data URL
}

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

  // timeline data - tracks[0] = Main, tracks[1] = Overlay
  const [tracks, setTracks] = useState<Clip[][]>([[], []])
  const [activeTrack, setActiveTrack] = useState<0|1>(0)
  const [selected, setSelected] = useState<{track: 0|1, id: string} | null>(null)
  const [library, setLibrary] = useState<LibraryItem[]>([])
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
  const [showSettings, setShowSettings] = useState(false)
  
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
        console.log('[ProjectLoad] Loaded project:', p)
        
        // Validate tracks structure
        if (p?.tracks && Array.isArray(p.tracks)) {
          const isValid = p.tracks.length === 2 && 
                         Array.isArray(p.tracks[0]) && 
                         Array.isArray(p.tracks[1])
          if (isValid) {
            console.log('[ProjectLoad] Restoring tracks:', p.tracks[0].length, 'clips on track 0,', p.tracks[1].length, 'clips on track 1')
            setTracks(p.tracks)
          } else {
            console.error('[ProjectLoad] Invalid tracks structure, ignoring')
          }
        }
        
        if (p?.pxPerSec && typeof p.pxPerSec === 'number') {
          console.log('[ProjectLoad] Restoring zoom:', p.pxPerSec)
          setPxPerSec(p.pxPerSec)
        }
        
        if (p?.library && Array.isArray(p.library)) {
          console.log('[ProjectLoad] Restoring library:', p.library.length, 'items')
          setLibrary(p.library)
        }
      }).catch((err: any) => {
        console.error('[ProjectLoad] Failed to load project:', err)
      })
    }
  }, [])

  // Save zoom level to localStorage
  useEffect(() => {
    localStorage.setItem('clipforge_pxPerSec', String(pxPerSec))
  }, [pxPerSec])

  // Autosave project when tracks, library, or zoom changes
  useEffect(() => {
    const payload = { tracks, library, pxPerSec }
    // best-effort debounce-ish save
    const t = setTimeout(() => {
      // @ts-expect-error preload
      if (window.clipforge?.projectSave) {
        // @ts-expect-error preload
        window.clipforge.projectSave(payload)
      }
    }, 400)
    return () => clearTimeout(t)
  }, [tracks, library, pxPerSec])

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
      if (e.key === '[' && selected) {
        e.preventDefault()
        const t = selected.track
        const id = selected.id
        setTracks(prev => {
          const copy = prev.map(r => r.slice()) as Clip[][]
          copy[t] = copy[t].map(c => {
            if (c.id !== id) return c
            const newIn = Math.max(0, c.in - 0.05)
            return { ...c, in: Math.min(newIn, c.out - 0.05) }
          })
          return copy
        })
        return
      }

      // ] = nudge Out by +0.05s
      if (e.key === ']' && selected) {
        e.preventDefault()
        const t = selected.track
        const id = selected.id
        setTracks(prev => {
          const copy = prev.map(r => r.slice()) as Clip[][]
          copy[t] = copy[t].map(c => {
            if (c.id !== id) return c
            const newOut = Math.min(c.duration, c.out + 0.05)
            return { ...c, out: Math.max(newOut, c.in + 0.05) }
          })
          return copy
        })
        return
      }

      // Backspace = delete selected
      if (e.key === 'Backspace' && selected) {
        e.preventDefault()
        deleteSelected()
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selected, tracks]) // eslint-disable-line react-hooks/exhaustive-deps

  // derive selected clip + local time mapping (for active track)
  // Using absolute positioning now
  const sequenceSpans = (() => {
    try {
      const arrTrack = tracks[activeTrack] || []
      const arr = arrTrack.map(c => {
        const len = Math.max(0.05, c.out - c.in)
        const start = c.startTime ?? 0
        return { id: c.id, start, len, clip: c }
      })
      const total = arr.length > 0 ? Math.max(...arr.map(b => b.start + b.len)) : 0
      return { arr, total }
    } catch (err) {
      console.error('[sequenceSpans] Error:', err)
      return { arr: [], total: 0 }
    }
  })()

  const selectedClip = selected
    ? tracks[selected.track]?.find(c => c.id === selected.id) || null
    : null

  // absTime -> selected clip & local time for the video element
  // Only auto-select when there's no current selection
  useEffect(() => {
    if (sequenceSpans.arr.length === 0) return
    // if no selection, pick the block at absTime (using absolute positioning)
    if (!selectedClip) {
      for (const b of sequenceSpans.arr) {
        const clipStart = b.start
        const clipEnd = b.start + b.len
        if (absTime >= clipStart && absTime <= clipEnd + 1e-6) {
          console.log('[Auto-select] Selecting clip at absTime', absTime, ':', b.clip.name)
          setSelected({ track: activeTrack, id: b.id })
          break
        }
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
  }, [selected?.track, selected?.id]) // eslint-disable-line react-hooks/exhaustive-deps

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
      playThroughRef.current = false
      
      // Multiple strategies to ensure playback resumes
      const attemptPlay = () => {
        if (!v) return
        const playPromise = v.play()
        if (playPromise !== undefined) {
          playPromise.catch(() => {}) // Ignore play errors
        }
      }
      
      // Strategy 1: Try with a small delay to let DOM settle
      setTimeout(() => {
        if (v.readyState >= 2) {
          attemptPlay()
        }
      }, 50)
      
      // Strategy 2: Listen for loadedmetadata
      const onLoaded = () => {
        v.removeEventListener('loadedmetadata', onLoaded)
        setTimeout(attemptPlay, 50)
      }
      v.addEventListener('loadedmetadata', onLoaded)
      
      // Strategy 3: Listen for canplay as backup
      const onCanPlay = () => {
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
      // Don't update absTime during recording
      if (isRecording) return
      
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
        // find next block
        const idx = sequenceSpans.arr.findIndex(b => b.id === selectedClip.id)
        const next = sequenceSpans.arr[idx + 1]
        if (next) {
          // Mark that we should continue playing after clip switch
          playThroughRef.current = true
          // Pause to prevent looping at boundary
          v.pause()
          // Switch to next clip
          setSelected({ track: activeTrack, id: next.id })
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
  }, [selectedClip, sequenceSpans.arr, isRecording])

  // Drag-and-drop import
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      e.preventDefault()
    }
    const onDrop = async (e: DragEvent) => {
      e.preventDefault()
      const rawPaths: string[] = []
      if (e.dataTransfer?.files?.length) {
        for (const f of Array.from(e.dataTransfer.files)) {
          // In Electron, File has a .path we can use
          // @ts-expect-error electron
          if (f.path) rawPaths.push((f as any).path)
        }
      }
      if (!rawPaths.length) return
      // @ts-expect-error preload
      const paths: string[] = await window.clipforge.importPaths(rawPaths)
      if (!paths.length) return
      for (const p of paths) {
        await addToLibrary(p)
      }
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Capture thumbnail from video
  const captureThumb = async (path: string, type: Mime): Promise<string | undefined> => {
    try {
      // @ts-expect-error preload
      const bytes: Uint8Array = await window.clipforge.readFileBytes(path)
      const blob = new Blob([bytes], { type })
      const url = URL.createObjectURL(blob)
      const v = document.createElement('video')
      v.preload = 'metadata'
      v.src = url
      await v.play().catch(()=>{}) // some browsers require play before seek
      v.pause()
      await new Promise<void>((res) => {
        if (v.readyState >= 1) return res()
        v.onloadedmetadata = () => res()
        setTimeout(res, 1000)
      })
      const w = Math.max(200, v.videoWidth)
      const h = Math.max(112, Math.round((v.videoHeight || 112) * (w/(v.videoWidth || 1))))
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(v, 0, 0, w, h)
      URL.revokeObjectURL(url)
      return canvas.toDataURL('image/jpeg', 0.72)
    } catch { return undefined }
  }

  // Add file to library
  const addToLibrary = async (absPath: string) => {
    try {
      console.log('[addToLibrary] Processing:', absPath)
      const name = (absPath.split(/[\\/]/).pop() || 'clip')
      console.log('[addToLibrary] Probing media...')
      const meta = await probeMedia(absPath)
      console.log('[addToLibrary] Meta:', meta)
      console.log('[addToLibrary] Capturing thumbnail...')
      const thumb = await captureThumb(absPath, mimeFor(absPath))
      console.log('[addToLibrary] Thumb captured:', thumb ? 'yes' : 'no')
      const item: LibraryItem = {
        id: nanoid(8),
        name, path: absPath,
        duration: meta.duration || 1,
        width: meta.width, height: meta.height,
        thumb
      }
      console.log('[addToLibrary] Adding to library state')
      setLibrary(prev => [...prev, item])
      console.log('[addToLibrary] Done')
    } catch (err) {
      console.error('[addToLibrary] Failed for', absPath, ':', err)
      throw err
    }
  }

  // Remove item from library
  const removeFromLibrary = (id: string) => {
    setLibrary(prev => prev.filter(item => item.id !== id))
  }

  // Add library item to end of track
  const appendClipToTrackEnd = (track: 0|1, item: LibraryItem) => {
    const color = COLORS[(tracks[track].length) % COLORS.length]
    // Calculate startTime as the rightmost edge of existing clips
    const existingClips = tracks[track]
    const rightmostEdge = existingClips.length > 0
      ? Math.max(...existingClips.map(c => (c.startTime ?? 0) + (c.out - c.in)))
      : 0
    
    const clip: Clip = {
      id: nanoid(8),
      name: item.name,
      path: item.path,
      in: 0,
      out: Math.max(0.05, item.duration || 1),
      duration: item.duration || 1,
      color,
      width: item.width, height: item.height,
      startTime: rightmostEdge,
    }
    setTracks(prev => {
      const copy = prev.map(r => r.slice()) as Clip[][]
      copy[track].push(clip)
      return copy
    })
    setSelected({ track, id: clip.id })
    // move playhead to start of new clip
    setAbsTime(rightmostEdge)
  }

  // Insert library item at specific position in track
  const insertClipAt = (track: 0|1, index: number, item: LibraryItem) => {
    try {
      console.log('[insertClipAt] track:', track, 'index:', index, 'item:', item.name)
      const color = COLORS[(tracks[track].length) % COLORS.length]
      
      // Calculate startTime: place at end of previous clip, or at 0 if first
      const existingClips = tracks[track]
      console.log('[insertClipAt] existingClips count:', existingClips.length)
      let startTime = 0
      
      if (index > 0 && index <= existingClips.length) {
        // Sort clips by startTime to find actual previous clip
        const sorted = [...existingClips].sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0))
        if (sorted[index - 1]) {
          const prevClip = sorted[index - 1]
          startTime = (prevClip.startTime ?? 0) + (prevClip.out - prevClip.in)
        }
      }
      console.log('[insertClipAt] initial startTime:', startTime)
      
      const newClipDuration = Math.max(0.05, item.duration || 1)
      console.log('[insertClipAt] newClipDuration:', newClipDuration)
      
      // Check for collisions and find valid position
      const otherClips = existingClips
        .map(c => ({
          start: c.startTime ?? 0,
          end: (c.startTime ?? 0) + (c.out - c.in)
        }))
        .sort((a, b) => a.start - b.start)
      
      console.log('[insertClipAt] otherClips:', otherClips)
      
      // Snap to non-overlapping position
      for (const other of otherClips) {
        const targetEnd = startTime + newClipDuration
        
        if (startTime < other.end && targetEnd > other.start) {
          // Collision detected, snap after this clip
          console.log('[insertClipAt] collision detected, snapping from', startTime, 'to', other.end)
          startTime = other.end
        }
      }
      
      console.log('[insertClipAt] final startTime:', startTime)
      
      const clip: Clip = {
        id: nanoid(8),
        name: item.name, path: item.path,
        in: 0, out: newClipDuration,
        duration: item.duration || 1,
        color, width: item.width, height: item.height,
        startTime,
      }
      console.log('[insertClipAt] created clip:', clip)
      
      setTracks(prev => {
        const copy = prev.map(r => r.slice()) as Clip[][]
        copy[track].push(clip) // Just append, position is determined by startTime
        return copy
      })
      console.log('[insertClipAt] tracks updated')
      
      setSelected({ track, id: clip.id })
      console.log('[insertClipAt] selection updated')
    } catch (err) {
      console.error('[insertClipAt] ERROR:', err)
      throw err
    }
  }

  // Import: add to library (not directly timeline)
  const onImport = async () => {
    try {
      console.log('[Import] Starting import...')
      // @ts-expect-error preload
      if (!window.clipforge?.openVideos) {
        alert('Bridge not available — check preload and sandbox:false')
        return
      }
      const paths: string[] = await window.clipforge.openVideos()
      console.log('[Import] Got paths:', paths)
      if (!paths?.length) return
      
      for (const p of paths) {
        console.log('[Import] Adding to library:', p)
        await addToLibrary(p)
        console.log('[Import] Added successfully:', p)
      }
      console.log('[Import] All imports complete')
    } catch (err) {
      console.error('[Import] Import failed:', err)
      alert(`Import failed: ${err}`)
    }
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

  // Handle completed screen recording - add to library
  const handleRecordingComplete = async (filePath: string) => {
    // Wait for file to be fully written
    await new Promise(resolve => setTimeout(resolve, 1000))
    await addToLibrary(filePath)
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

  // Move clip to new start time (absolute positioning with collision detection)
  const onMove = (track: 0|1, id: string, newStartTime: number) => {
    setTracks(prev => {
      const copy = prev.map(r => r.slice()) as Clip[][]
      const clip = copy[track].find(c => c.id === id)
      if (!clip) return prev
      
      const clipDuration = clip.out - clip.in
      let targetStart = Math.max(0, newStartTime)
      
      // Get other clips on same track with their time ranges
      const otherClips = copy[track]
        .filter(c => c.id !== id)
        .map(c => ({
          start: c.startTime ?? 0,
          end: (c.startTime ?? 0) + (c.out - c.in),
          clip: c
        }))
        .sort((a, b) => a.start - b.start)
      
      // Check for collisions and snap to nearest valid position
      for (const other of otherClips) {
        const targetEnd = targetStart + clipDuration
        
        // If we'd overlap with this clip
        if (targetStart < other.end && targetEnd > other.start) {
          // Try snapping before this clip
          const snapBefore = other.start - clipDuration
          // Try snapping after this clip
          const snapAfter = other.end
          
          // Choose the snap position closest to target
          const distBefore = Math.abs(snapBefore - targetStart)
          const distAfter = Math.abs(snapAfter - targetStart)
          
          if (snapBefore >= 0 && distBefore < distAfter) {
            targetStart = snapBefore
          } else {
            targetStart = snapAfter
          }
        }
      }
      
      copy[track] = copy[track].map(c => 
        c.id === id ? { ...c, startTime: targetStart } : c
      )
      return copy
    })
  }

  // Trim adjust
  const onTrim = (track: 0|1, id: string, which: 'in' | 'out', next: number) => {
    setTracks(prev => {
      const copy = prev.map(r => r.slice()) as Clip[][]
      copy[track] = copy[track].map(c => {
        if (c.id !== id) return c
        if (which === 'in') return { ...c, in: Math.max(0, Math.min(next, c.out - 0.05)) }
        else return { ...c, out: Math.min(c.duration, Math.max(next, c.in + 0.05)) }
      })
      return copy
    })
  }

  // Split at playhead
  const splitAtPlayhead = () => {
    if (!selected) return
    const t = selected.track
    const id = selected.id
    const idx = tracks[t].findIndex(c => c.id === id)
    if (idx < 0) return
    const c = tracks[t][idx]
    const startAbs = sequenceSpans.arr.find(b => b.id === c.id)?.start ?? 0
    const local = c.in + Math.max(0, absTime - startAbs)
    if (local <= c.in + 0.05 || local >= c.out - 0.05) return // too close, skip

    const left = { ...c, id: nanoid(8), out: local }
    // Right clip starts at left's end time
    const rightStartTime = (c.startTime ?? 0) + (local - c.in)
    const right = { ...c, id: nanoid(8), in: local, name: c.name + ' (2)', startTime: rightStartTime }
    setTracks(prev => {
      const copy = prev.map(r => r.slice()) as Clip[][]
      copy[t].splice(idx, 1, left, right)
      return copy
    })
    setSelected({ track: t, id: right.id })
  }

  // Delete selected
  const deleteSelected = () => {
    if (!selected) return
    
    const t = selected.track
    const id = selected.id
    
    // Pause video and clear source if deleting the currently playing clip
    const v = videoRef.current
    if (v) {
      v.pause()
    }
    
    setTracks(prev => {
      const copy = prev.map(r => r.slice()) as Clip[][]
      copy[t] = copy[t].filter(c => c.id !== id)
      return copy
    })
    setSelected(null)
    
    // If no clips left in any track, clear the video
    if (tracks[0].length + tracks[1].length === 0) {
      if (src) {
        URL.revokeObjectURL(src)
      }
      setSrc(null)
      setFileName('')
    }
  }

  // Export timeline (active track only for now)
  const exportTimeline = async () => {
    if (!tracks[activeTrack].length) return
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
        <button 
          onClick={() => {
            if (tracks[0].length || tracks[1].length || library.length) {
              if (!confirm('Clear all clips and library items? This cannot be undone.')) return
            }
            setTracks([[], []])
            setLibrary([])
            setSelected(null)
            setAbsTime(0)
            setFileName('')
            if (videoRef.current) {
              videoRef.current.src = ''
              videoRef.current.load()
            }
          }}
          style={{ background:'#ef4444', color:'#fff', fontWeight:500 }}
          title="Start a new project (clears everything)"
        >
          🆕 New Project
        </button>
        <button onClick={onImport}>➕ Import</button>
        <button onClick={splitAtPlayhead} disabled={!selected}>✂️ Split</button>
        <button onClick={deleteSelected} disabled={!selected}>🗑️ Delete</button>
        
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
        <button onClick={exportTimeline} disabled={!tracks[activeTrack].length}>📤 Export Timeline</button>
        
        {/* AI Summarization */}
        <div style={{ marginLeft: 'auto', display:'flex', alignItems:'center', gap:8, borderLeft:'1px solid #ddd', paddingLeft:12 }}>
          <label style={{ fontSize:12, color:'#555' }}>AI Summary:</label>
          <input
            type="number"
            min={5}
            max={90}
            defaultValue={30}
            id="aiPct"
            style={{ width: 56, padding:'4px 6px', fontSize:12, border:'1px solid #ddd', borderRadius:4 }}
          />
          <span style={{ fontSize:11, color:'#666' }}>%</span>
          <button
            onClick={async () => {
              const pctEl = document.getElementById('aiPct') as HTMLInputElement
              const pct = Math.max(5, Math.min(90, Number(pctEl.value || 30)))
              // Use the active track's clips
              const parts = sequenceSpans.arr.map(b => ({
                inputPath: b.clip.path,
                tIn: b.clip.in,
                tOut: b.clip.out,
              }))
              if (!parts.length) {
                alert('Add some clips to the timeline first')
                return
              }
              setWorking('AI summarizing… (this may take a few minutes)')
              setProgress('Extracting audio and transcribing...')
              try {
                // @ts-expect-error preload
                const res = await window.clipforge.aiSummarize({ parts, targetRatio: pct/100 })
                if (res.saved && res.path) {
                  setWorking('Adding summary to library...')
                  // Add the summary to the media library
                  await addToLibrary(res.path)
                  setWorking('AI Summary created & added to library ✅')
                } else {
                  setWorking('Canceled')
                }
                setProgress('')
              } catch (e: any) {
                console.error(e)
                setWorking('AI summary failed ❌')
                setProgress(e.message || 'Unknown error')
              } finally {
                setTimeout(()=>{ setWorking(''); setProgress('') }, 3000)
              }
            }}
            disabled={!tracks[activeTrack].length}
            style={{ padding:'6px 12px', fontSize:13, background:'#7c3aed', color:'#fff', border:'none', borderRadius:4, cursor:'pointer', fontWeight:500 }}
            title="Use AI to create a shorter version with the most important parts"
          >
            ✨ Summarize
          </button>
          <button
            onClick={() => setShowSettings(true)}
            style={{ 
              padding:'6px 12px', 
              fontSize:18, 
              background:'transparent', 
              color:'#666', 
              border:'1px solid #ddd', 
              borderRadius:4, 
              cursor:'pointer',
              lineHeight: 1,
              marginLeft: 8
            }}
            title="Settings"
          >
            ⚙️
          </button>
        </div>
        
        <span className="meta">{working}</span>
      </div>
      
      {/* Settings Modal */}
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}

      {/* Sidebar + main grid */}
      <div className="main" style={{ 
        display: 'grid',
        gridTemplateColumns: '240px 1fr', 
        gridTemplateRows: '1fr auto', 
        gridTemplateAreas: '"lib player" "lib timeline"', 
        height:'calc(100vh - 52px)' 
      }}>
        {/* Left rail: Media Library */}
        <div style={{ gridArea:'lib', display:'flex', flexDirection:'column' }}>
          <MediaLibrary items={library} onDelete={removeFromLibrary} />
          <div style={{ padding:8, borderTop:'1px solid #eee', borderRight:'1px solid #eee' }}>
            <div style={{ fontSize:12, marginBottom:6 }}>Active track:</div>
            <div style={{ display:'flex', gap:6 }}>
              <button 
                onClick={()=>setActiveTrack(0)} 
                style={{ 
                  padding:'4px 8px', fontSize:12, 
                  background: activeTrack===0?'#2563eb':'#fff', 
                  color: activeTrack===0?'#fff':'#333', 
                  border:'1px solid #ddd', borderRadius:4 
                }}
              >
                Main
              </button>
              <button 
                onClick={()=>setActiveTrack(1)} 
                style={{ 
                  padding:'4px 8px', fontSize:12, 
                  background: activeTrack===1?'#2563eb':'#fff', 
                  color: activeTrack===1?'#fff':'#333', 
                  border:'1px solid #ddd', borderRadius:4 
                }}
              >
                Overlay
              </button>
            </div>
            <div style={{ marginTop:8 }}>
              <button 
                onClick={()=>{
                  const it = library[library.length-1]
                  if (it) appendClipToTrackEnd(activeTrack, it)
                }} 
                style={{ padding:'4px 8px', fontSize:12 }}
                disabled={!library.length}
              >
                Add last to active
              </button>
            </div>
          </div>
        </div>

        {/* Player */}
        <div className="player" style={{ gridArea:'player' }}>
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
              <p>Drag & drop videos or click Import to get started.</p>
            </div>
          )}
        </div>

        {/* Timeline */}
        <div className="timeline" style={{ gridArea:'timeline' }}>
          <div className="timelineHeader">
            <b>Timeline</b>
            <span style={{ marginLeft:8, fontSize:12, color:'#666' }}>Tracks: Main (0) + Overlay (1)</span>
            <button onClick={() => setPxPerSec(v => Math.max(0.5, Math.floor(v * 0.8 * 100) / 100))} style={{ padding:'2px 6px', marginLeft:'auto' }}>–</button>
            <button onClick={() => setPxPerSec(v => Math.min(800, Math.ceil(v * 1.25)))} style={{ padding:'2px 6px' }}>+</button>
            <span style={{ color:'#666' }}>{pxPerSec < 10 ? pxPerSec.toFixed(1) : Math.round(pxPerSec)} px/s</span>
          </div>

          <div className="timelineWrap">
            <TimelineCanvas
              tracks={tracks}
              activeTrack={activeTrack}
              selected={selected}
              setSelected={setSelected}
              pxPerSec={pxPerSec}
              setPxPerSec={setPxPerSec}
              absTime={absTime}
              setAbsTime={setAbsTimeFromUser}
              onMove={onMove}
              onTrim={onTrim}
              onExternalDrop={(track, atIndex, libId) => {
                try {
                  console.log('[onExternalDrop] track:', track, 'atIndex:', atIndex, 'libId:', libId)
                  const it = library.find(x => x.id === libId)
                  console.log('[onExternalDrop] found item:', it?.name)
                  if (!it) {
                    console.error('[onExternalDrop] item not found in library!')
                    return
                  }
                  insertClipAt(track, atIndex, it)
                } catch (err) {
                  console.error('[onExternalDrop] ERROR:', err)
                }
              }}
            />
          </div>
        </div>
      </div>

      {/* Recording Panel (positioned outside main grid) */}
      <RecordingPanel 
        onRecordingComplete={handleRecordingComplete}
        videoRef={videoRef}
        setIsRecording={setIsRecording}
      />

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

