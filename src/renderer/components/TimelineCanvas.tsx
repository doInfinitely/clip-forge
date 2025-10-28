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
}

type Props = {
  clips: Clip[]
  selectedId: string | null
  setSelectedId: (id: string) => void
  pxPerSec: number
  setPxPerSec: (v: number) => void
  absTime: number
  setAbsTime: (t: number) => void
  onReorder: (fromId: string, toIndex: number) => void
  onTrim: (id: string, which: 'in' | 'out', next: number) => void
}

const TL_HEIGHT = 100
const CLIP_H = 56
const CLIP_Y = (TL_HEIGHT - CLIP_H) / 2
const HANDLE_W = 6
const MIN_LEN = 0.05
const MIN_PX  = 24 // Keep large enough for interaction with handles
const SNAP_THRESHOLD = 0.1 // snap within 0.1s

export default function TimelineCanvas({
  clips, selectedId, setSelectedId,
  pxPerSec, setPxPerSec,
  absTime, setAbsTime,
  onReorder, onTrim,
}: Props) {
  const stageRef = useRef<any>(null)
  const [vw, setVw] = useState<number>(typeof window !== 'undefined' ? window.innerWidth : 800)
  useEffect(() => {
    const onR = () => setVw(window.innerWidth)
    window.addEventListener('resize', onR)
    return () => window.removeEventListener('resize', onR)
  }, [])
  const stageX = () =>
    stageRef.current?.getStage()?.getPointerPosition()?.x ?? 0

  const spans = useMemo(() => {
    const arr: Array<{id: string; start: number; len: number; clip: Clip}> = []
    let acc = 0
    for (const c of clips) {
      const len = Math.max(MIN_LEN, c.out - c.in)
      arr.push({ id: c.id, start: acc, len, clip: c })
      acc += len
    }
    return { blocks: arr, total: acc }
  }, [clips])

  const timeToClipIndex = (t: number) => {
    let acc = 0
    for (let i = 0; i < spans.blocks.length; i++) {
      const b = spans.blocks[i]
      if (t >= acc && t <= acc + b.len + 1e-6) return i
      acc += b.len
    }
    return Math.max(0, spans.blocks.length - 1)
  }

  // Snap helper: snap to whole seconds and neighbor edges
  const snapTime = (time: number, clipId: string, which: 'in' | 'out') => {
    let snapped = time
    
    // Snap to whole seconds
    const rounded = Math.round(time)
    if (Math.abs(time - rounded) < SNAP_THRESHOLD) {
      snapped = rounded
    }
    
    // Snap to neighbor edges
    const currentClipIndex = spans.blocks.findIndex(b => b.id === clipId)
    if (currentClipIndex >= 0) {
      const currentClip = clips[currentClipIndex]
      
      if (which === 'in') {
        // Snap left handle to previous clip's out point
        if (currentClipIndex > 0) {
          const prevClip = clips[currentClipIndex - 1]
          if (Math.abs(time - prevClip.out) < SNAP_THRESHOLD) {
            snapped = prevClip.out
          }
        }
      } else {
        // Snap right handle to next clip's in point
        if (currentClipIndex < clips.length - 1) {
          const nextClip = clips[currentClipIndex + 1]
          if (Math.abs(time - nextClip.in) < SNAP_THRESHOLD) {
            snapped = nextClip.in
          }
        }
      }
    }
    
    return snapped
  }

  const width = Math.max(600, spans.total * pxPerSec + 80)
  const contentWidth = Math.max(Math.max(600, spans.total * pxPerSec + 80), vw)

  const onBackgroundMouseDown = (e: any) => {
    // Only respond if clicking directly on the background, not on clips
    if (e.target !== e.currentTarget) return
    
    const x = e.target.getStage().getPointerPosition().x
    const t = Math.max(0, (x - 40) / pxPerSec)
    setAbsTime(t)
    const idx = timeToClipIndex(t)
    const targetBlock = spans.blocks[idx]
    if (targetBlock) setSelectedId(targetBlock.id)
  }

  return (
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
        
        {/* grid */}
        {Array.from({ length: Math.ceil(width / pxPerSec) + 1 }).map((_, i) => (
          <Line
            key={`g${i}`}
            points={[40 + i * pxPerSec, 0, 40 + i * pxPerSec, TL_HEIGHT]}
            stroke="#eee"
            strokeWidth={1}
            listening={false}
          />
        ))}

        {/* clips */}
        {spans.blocks.map((b) => {
          const x = 40 + b.start * pxPerSec
          const actualW = b.len * pxPerSec
          const w = Math.max(MIN_PX, actualW)
          const isSel = b.id === selectedId
          const c = b.clip

          const onDragEnd = (evt: any) => {
            const nx = evt.target.x()
            const center = (nx - 40) + w / 2
            const newAbs = Math.max(0, center / pxPerSec)
            let acc = 0
            let newIndex = 0
            for (let i = 0; i < spans.blocks.length; i++) {
              const L = spans.blocks[i].len
              if (newAbs < acc + L / 2) { newIndex = i; break }
              acc += L
              newIndex = i
              if (i === spans.blocks.length - 1 && newAbs >= acc) newIndex = i
            }
            onReorder(b.id, newIndex)
          }

          const onLeftDragMove = (e: any) => {
            const abs = e.target.getStage().getPointerPosition().x
            const localSec = (abs - 40) / pxPerSec - b.start
            let nextIn = c.in + localSec
            nextIn = Math.max(0, Math.min(nextIn, c.out - MIN_LEN))
            nextIn = snapTime(nextIn, c.id, 'in')
            onTrim(c.id, 'in', nextIn)
          }
          const onRightDragMove = (e: any) => {
            const abs = e.target.getStage().getPointerPosition().x
            const localSec = (abs - 40) / pxPerSec - b.start
            let nextOut = c.in + localSec
            nextOut = Math.max(c.in + MIN_LEN, Math.min(nextOut, c.duration))
            nextOut = snapTime(nextOut, c.id, 'out')
            onTrim(c.id, 'out', nextOut)
          }

          return (
            <Group 
              key={b.id}
              x={x}
              y={0}
              draggable={false}
            >
              <Rect
                x={0} y={CLIP_Y}
                width={w} height={CLIP_H}
                cornerRadius={8}
                fill={c.color}
                opacity={isSel ? 0.9 : 0.7}
                stroke={isSel ? '#111' : '#bbb'}
                strokeWidth={isSel ? 2 : 1}
                draggable
                dragBoundFunc={(pos) => {
                  // Allow dragging anywhere horizontally
                  return { x: pos.x, y: CLIP_Y }
                }}
                onDragEnd={(e) => {
                  const deltaX = e.target.x()
                  e.target.x(0) // Reset to 0
                  
                  // Calculate new absolute position in timeline
                  const newAbsX = x + deltaX
                  const centerX = newAbsX + w / 2
                  const centerTime = Math.max(0, (centerX - 40) / pxPerSec)
                  
                  // Find which position this time corresponds to
                  let acc = 0
                  let newIndex = 0
                  for (let i = 0; i < spans.blocks.length; i++) {
                    const blockMidpoint = acc + spans.blocks[i].len / 2
                    if (centerTime < blockMidpoint) {
                      newIndex = i
                      break
                    }
                    acc += spans.blocks[i].len
                    newIndex = i + 1
                  }
                  
                  // Don't allow moving past the last position
                  newIndex = Math.min(newIndex, spans.blocks.length - 1)
                  
                  onReorder(b.id, newIndex)
                }}
                onMouseDown={(e) => { 
                  const clickX = e.target.getStage().getPointerPosition().x
                  const t = Math.max(0, (clickX - 40) / pxPerSec)
                  setAbsTime(t)
                  setSelectedId(c.id)
                }}
              />
              <Text
                x={10} y={CLIP_Y + 18}
                text={c.name}
                fontSize={12}
                fill="#111"
                listening={false}
              />
              {/* left handle */}
              <Rect
                x={0}
                y={CLIP_Y}
                width={HANDLE_W}
                height={CLIP_H}
                fill="#333"
                opacity={0.6}
                onMouseDown={(e) => {
                  e.cancelBubble = true
                  e.evt.stopPropagation()
                  e.evt.preventDefault()
                  setSelectedId(c.id)
                  
                  const stage = e.target.getStage()
                  const startX = stage.getPointerPosition().x
                  const startIn = c.in
                  
                  const onMove = () => {
                    const currentX = stage.getPointerPosition()?.x ?? startX
                    const deltaX = currentX - startX
                    const deltaSec = deltaX / pxPerSec
                    let nextIn = startIn + deltaSec
                    nextIn = Math.max(0, Math.min(nextIn, c.out - MIN_LEN))
                    nextIn = snapTime(nextIn, c.id, 'in')
                    onTrim(c.id, 'in', nextIn)
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
              {/* right handle */}
              <Rect
                x={w - HANDLE_W}
                y={CLIP_Y}
                width={HANDLE_W}
                height={CLIP_H}
                fill="#333"
                opacity={0.6}
                onMouseDown={(e) => {
                  e.cancelBubble = true
                  e.evt.stopPropagation()
                  e.evt.preventDefault()
                  setSelectedId(c.id)
                  
                  const stage = e.target.getStage()
                  const startX = stage.getPointerPosition().x
                  const startOut = c.out
                  
                  const onMove = () => {
                    const currentX = stage.getPointerPosition()?.x ?? startX
                    const deltaX = currentX - startX
                    const deltaSec = deltaX / pxPerSec
                    let nextOut = startOut + deltaSec
                    nextOut = Math.max(c.in + MIN_LEN, Math.min(nextOut, c.duration))
                    nextOut = snapTime(nextOut, c.id, 'out')
                    onTrim(c.id, 'out', nextOut)
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
        })}

        {/* playhead */}
        <Line
          points={[
            40 + absTime * pxPerSec, 0,
            40 + absTime * pxPerSec, TL_HEIGHT
          ]}
          stroke="#e11d48"
          strokeWidth={2}
        />
      </Layer>
    </Stage>
  )
}

