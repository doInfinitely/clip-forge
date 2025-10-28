// src/renderer/components/TimelineCanvas.tsx
import React, { useMemo, useRef, useState, useEffect } from 'react'
import { Stage, Layer, Rect, Line, Group, Text } from 'react-konva'

export type Clip = {
  id: string
  name: string
  path: string
  in: number
  out: number
  duration: number
  color: string
  width?: number
  height?: number
  startTime?: number  // absolute start time on track (for non-sequential positioning)
}

type Props = {
  tracks: Clip[][]
  activeTrack: 0|1
  selected: {track: 0|1, id: string} | null
  setSelected: (sel: {track:0|1,id:string} | null) => void
  pxPerSec: number
  setPxPerSec: (v: number) => void
  absTime: number
  setAbsTime: (t: number) => void
  onMove: (track: 0|1, id: string, newStartTime: number) => void
  onTrim: (track: 0|1, id: string, which: 'in' | 'out', next: number) => void
  onExternalDrop?: (track: 0|1, atIndex: number, libId: string) => void
}

const TL_HEIGHT = 100
const ROW_H = 50
const ROW_GAP = 0
const CLIP_H = 36
const ROW_Y = (row: 0|1) => row * (ROW_H + ROW_GAP)
const CLIP_Y = (row: 0|1) => ROW_Y(row) + Math.round((ROW_H - CLIP_H) / 2)

const HANDLE_W = 6
const MIN_LEN = 0.05
const MIN_PX  = 24 // Keep large enough for interaction with handles
const SNAP_THRESHOLD = 0.1 // snap within 0.1s

export default function TimelineCanvas({
  tracks, activeTrack, selected, setSelected,
  pxPerSec, setPxPerSec,
  absTime, setAbsTime,
  onMove, onTrim,
  onExternalDrop,
}: Props) {
  const stageRef = useRef<any>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [vw, setVw] = useState<number>(typeof window !== 'undefined' ? window.innerWidth : 800)
  
  useEffect(() => {
    const onR = () => setVw(window.innerWidth)
    window.addEventListener('resize', onR)
    return () => window.removeEventListener('resize', onR)
  }, [])

  // Compute spans for both tracks (using absolute positioning)
  const spansByTrack = useMemo(() => {
    try {
      console.log('[TimelineCanvas] Computing spans for tracks:', tracks[0]?.length, tracks[1]?.length)
      return tracks.map((trackClips, trackIdx) => {
        const arr: Array<{id: string; start: number; len: number; clip: Clip}> = []
        for (const c of trackClips) {
          if (!c) {
            console.error('[TimelineCanvas] Null clip in track', trackIdx)
            continue
          }
          const len = Math.max(MIN_LEN, c.out - c.in)
          const start = c.startTime ?? 0  // use absolute startTime if set, else 0
          arr.push({ id: c.id, start, len, clip: c })
        }
        // Calculate total as the rightmost edge
        const total = arr.length > 0 
          ? Math.max(...arr.map(b => b.start + b.len))
          : 0
        console.log('[TimelineCanvas] Track', trackIdx, ':', arr.length, 'clips, total:', total)
        return { blocks: arr, total }
      })
    } catch (err) {
      console.error('[TimelineCanvas] Error computing spans:', err)
      return [{ blocks: [], total: 0 }, { blocks: [], total: 0 }]
    }
  }, [tracks])

  const maxTotal = Math.max(spansByTrack[0]?.total || 0, spansByTrack[1]?.total || 0, 10)
  
  // Canvas has a max width limit (~32k pixels), so clamp it
  const MAX_CANVAS_WIDTH = 30000
  let effectivePxPerSec = pxPerSec
  let rawWidth = maxTotal * pxPerSec + 80
  
  // If the timeline would be too wide, automatically reduce zoom
  if (rawWidth > MAX_CANVAS_WIDTH) {
    effectivePxPerSec = (MAX_CANVAS_WIDTH - 80) / maxTotal
    rawWidth = MAX_CANVAS_WIDTH
    console.warn('[TimelineCanvas] Timeline too wide, auto-reducing zoom from', pxPerSec, 'to', effectivePxPerSec.toFixed(2))
  }
  
  const width = Math.max(600, rawWidth)
  const contentWidth = Math.max(width, vw)
  
  console.log('[TimelineCanvas] maxTotal:', maxTotal.toFixed(2), 's, zoom:', effectivePxPerSec.toFixed(2), 'px/s, width:', width.toFixed(0), 'px')

  // Snap helper
  const snapTime = (time: number, track: 0|1, clipId: string, which: 'in' | 'out') => {
    let snapped = time
    
    // Snap to whole seconds
    const rounded = Math.round(time)
    if (Math.abs(time - rounded) < SNAP_THRESHOLD) {
      snapped = rounded
    }
    
    // Snap to neighbor edges
    const trackClips = tracks[track]
    const currentClipIndex = trackClips.findIndex(c => c.id === clipId)
    if (currentClipIndex >= 0) {
      if (which === 'in' && currentClipIndex > 0) {
        const prevClip = trackClips[currentClipIndex - 1]
        if (Math.abs(time - prevClip.out) < SNAP_THRESHOLD) {
          snapped = prevClip.out
        }
      } else if (which === 'out' && currentClipIndex < trackClips.length - 1) {
        const nextClip = trackClips[currentClipIndex + 1]
        if (Math.abs(time - nextClip.in) < SNAP_THRESHOLD) {
          snapped = nextClip.in
        }
      }
    }
    
    return snapped
  }

  const onBackgroundMouseDown = (e: any) => {
    // Only respond if clicking directly on the background
    if (e.target !== e.currentTarget) return
    
    const stage = e.target.getStage()
    const pos = stage.getPointerPosition()
    const x = pos.x
    const y = pos.y
    
    // Determine which track was clicked
    const track: 0|1 = y < ROW_H ? 0 : 1
    const t = Math.max(0, (x - 40) / effectivePxPerSec)
    setAbsTime(t)
    
    // Find clip at this time in the clicked track (using absolute positioning)
    const spans = spansByTrack[track]
    for (const b of spans.blocks) {
      const clipStart = b.start
      const clipEnd = b.start + b.len
      if (t >= clipStart && t <= clipEnd + 1e-6) {
        setSelected({ track, id: b.id })
        return
      }
    }
  }

  // HTML5 drop handler for external library items
  const handleDrop: React.DragEventHandler<HTMLDivElement> = (e) => {
    if (!onExternalDrop) return
    const libId = e.dataTransfer.getData('application/x-clipforge-media-id')
    if (!libId) return
    e.preventDefault()
    const rect = containerRef.current!.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const track: 0|1 = y < ROW_H ? 0 : 1
    const spans = spansByTrack[track]
    const tSec = Math.max(0, (x - 40) / effectivePxPerSec)
    
    // Find index - insert before the first clip whose midpoint is after tSec
    let idx = 0
    for (let i = 0; i < spans.blocks.length; i++) {
      const clipStart = spans.blocks[i].start
      const clipMid = clipStart + spans.blocks[i].len / 2
      if (tSec < clipMid) {
        idx = i
        break
      }
      idx = i + 1
    }
    onExternalDrop(track, idx, libId)
  }

  const handleDragOver: React.DragEventHandler<HTMLDivElement> = (e) => {
    if (e.dataTransfer.types.includes('application/x-clipforge-media-id')) {
      e.preventDefault()
    }
  }

  return (
    <div ref={containerRef} onDrop={handleDrop} onDragOver={handleDragOver}>
      <Stage
        ref={stageRef}
        width={contentWidth}
        height={TL_HEIGHT}
        style={{ background:'#fafafa', borderTop:'1px solid #eee' }}
      >
        <Layer>
          {/* Background rect for playhead scrubbing */}
          <Rect
            x={0}
            y={0}
            width={contentWidth}
            height={TL_HEIGHT}
            fill="transparent"
            onMouseDown={onBackgroundMouseDown}
          />
          
          {/* Grid lines */}
          {Array.from({ length: Math.ceil(width / effectivePxPerSec) + 1 }).map((_, i) => (
            <Line
              key={`g${i}`}
              points={[40 + i * effectivePxPerSec, 0, 40 + i * effectivePxPerSec, TL_HEIGHT]}
              stroke="#eee"
              strokeWidth={1}
              listening={false}
            />
          ))}

          {/* Track separators */}
          <Line
            points={[0, ROW_H, contentWidth, ROW_H]}
            stroke="#ccc"
            strokeWidth={1}
            listening={false}
          />

          {/* Render clips for each track */}
          {[0, 1].map(trackIdx => {
            const t = trackIdx as 0|1
            const spans = spansByTrack[t]
            const trackY = ROW_Y(t)
            const clipY = CLIP_Y(t)

            return spans.blocks.map((b) => {
              const x = 40 + b.start * effectivePxPerSec
              const actualW = b.len * effectivePxPerSec
              const w = Math.max(MIN_PX, actualW)
              const isSel = selected?.track === t && selected.id === b.id
              const c = b.clip

              return (
                <Group 
                  key={`${t}-${b.id}`}
                  x={x}
                  y={0}
                  draggable={false}
                >
                  <Rect
                    x={0} y={clipY}
                    width={w} height={CLIP_H}
                    cornerRadius={8}
                    fill={c.color}
                    opacity={isSel ? 0.9 : 0.7}
                    stroke={isSel ? '#111' : '#bbb'}
                    strokeWidth={isSel ? 2 : 1}
                    draggable
                    dragBoundFunc={(pos) => {
                      // Allow dragging anywhere horizontally within this track row
                      return { x: pos.x, y: clipY }
                    }}
                    onDragEnd={(e) => {
                      const deltaX = e.target.x()
                      e.target.x(0) // Reset to 0
                      
                      // Calculate new start time
                      const newX = x + deltaX
                      const newStartTime = Math.max(0, (newX - 40) / effectivePxPerSec)
                      
                      onMove(t, b.id, newStartTime)
                    }}
                    onMouseDown={(e) => { 
                      const clickX = e.target.getStage().getPointerPosition().x
                      const time = Math.max(0, (clickX - 40) / effectivePxPerSec)
                      setAbsTime(time)
                      setSelected({ track: t, id: c.id })
                    }}
                  />
                  <Text
                    x={8} y={clipY + 6}
                    text={c.name}
                    fontSize={10}
                    fill="#111"
                    listening={false}
                  />
                  <Text
                    x={8} y={clipY + 20}
                    text={`${(c.duration).toFixed(2)}s` + (c.width && c.height ? ` • ${c.width}×${c.height}` : '')}
                    fontSize={8}
                    fill="#333"
                    listening={false}
                  />
                  
                  {/* Left handle */}
                  <Rect
                    x={0}
                    y={clipY}
                    width={HANDLE_W}
                    height={CLIP_H}
                    fill="#333"
                    opacity={0.6}
                    onMouseDown={(e) => {
                      e.cancelBubble = true
                      e.evt.stopPropagation()
                      e.evt.preventDefault()
                      setSelected({ track: t, id: c.id })
                      
                      const stage = e.target.getStage()
                      const startX = stage.getPointerPosition().x
                      const startIn = c.in
                      
                      const onMove = () => {
                        const currentX = stage.getPointerPosition()?.x ?? startX
                        const deltaX = currentX - startX
                        const deltaSec = deltaX / effectivePxPerSec
                        let nextIn = startIn + deltaSec
                        nextIn = Math.max(0, Math.min(nextIn, c.out - MIN_LEN))
                        nextIn = snapTime(nextIn, t, c.id, 'in')
                        onTrim(t, c.id, 'in', nextIn)
                      }
                      
                      const onUp = () => {
                        stage.off('mousemove', onMove)
                        stage.off('mouseup', onUp)
                        stage.off('mouseleave', onUp)
                      }
                      
                      stage.on('mousemove', onMove)
                      stage.on('mouseup', onUp)
                      stage.on('mouseleave', onUp)
                    }}
                  />
                  
                  {/* Right handle */}
                  <Rect
                    x={w - HANDLE_W}
                    y={clipY}
                    width={HANDLE_W}
                    height={CLIP_H}
                    fill="#333"
                    opacity={0.6}
                    onMouseDown={(e) => {
                      e.cancelBubble = true
                      e.evt.stopPropagation()
                      e.evt.preventDefault()
                      setSelected({ track: t, id: c.id })
                      
                      const stage = e.target.getStage()
                      const startX = stage.getPointerPosition().x
                      const startOut = c.out
                      
                      const onMove = () => {
                        const currentX = stage.getPointerPosition()?.x ?? startX
                        const deltaX = currentX - startX
                        const deltaSec = deltaX / effectivePxPerSec
                        let nextOut = startOut + deltaSec
                        nextOut = Math.max(c.in + MIN_LEN, Math.min(nextOut, c.duration))
                        nextOut = snapTime(nextOut, t, c.id, 'out')
                        onTrim(t, c.id, 'out', nextOut)
                      }
                      
                      const onUp = () => {
                        stage.off('mousemove', onMove)
                        stage.off('mouseup', onUp)
                        stage.off('mouseleave', onUp)
                      }
                      
                      stage.on('mousemove', onMove)
                      stage.on('mouseup', onUp)
                      stage.on('mouseleave', onUp)
                    }}
                  />
                </Group>
              )
            })
          })}

          {/* Playhead (only show on active track) */}
          <Line
            points={[
              40 + absTime * effectivePxPerSec, ROW_Y(activeTrack),
              40 + absTime * effectivePxPerSec, ROW_Y(activeTrack) + ROW_H
            ]}
            stroke="#e11d48"
            strokeWidth={2}
          />
        </Layer>
      </Stage>
    </div>
  )
}
