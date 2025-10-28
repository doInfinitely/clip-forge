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
const MIN_PX  = 24

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

  const width = Math.max(600, spans.total * pxPerSec + 80)
  const contentWidth = Math.max(Math.max(600, spans.total * pxPerSec + 80), vw)

  const onBackgroundMouseDown = (e: any) => {
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
      onMouseDown={onBackgroundMouseDown}
      style={{ background:'#fafafa', borderTop:'1px solid #eee' }}
    >
      <Layer>
        {/* grid */}
        {Array.from({ length: Math.ceil(width / pxPerSec) + 1 }).map((_, i) => (
          <Line
            key={`g${i}`}
            points={[40 + i * pxPerSec, 0, 40 + i * pxPerSec, TL_HEIGHT]}
            stroke="#eee"
            strokeWidth={1}
          />
        ))}

        {/* clips */}
        {spans.blocks.map((b) => {
          const x = 40 + b.start * pxPerSec
          const w = Math.max(MIN_PX, b.len * pxPerSec)
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

          const onLeftDragMove = () => {
            const abs = stageX()
            const localSec = (abs - (40 + b.start * pxPerSec)) / pxPerSec
            const nextIn = Math.max(0, Math.min(c.in + localSec, c.out - MIN_LEN))
            onTrim(c.id, 'in', nextIn)
          }
          const onRightDragMove = () => {
            const abs = stageX()
            const localSec = (abs - (40 + b.start * pxPerSec)) / pxPerSec
            const nextOut = Math.max(c.in + MIN_LEN, Math.min(c.in + localSec, c.duration))
            onTrim(c.id, 'out', nextOut)
          }

          return (
            <Group key={b.id}>
              <Rect
                x={x} y={CLIP_Y}
                width={w} height={CLIP_H}
                cornerRadius={8}
                fill={c.color}
                opacity={isSel ? 0.9 : 0.7}
                stroke={isSel ? '#111' : '#bbb'}
                strokeWidth={isSel ? 2 : 1}
                draggable
                dragBoundFunc={(pos) => ({ x: Math.max(40, Math.min(pos.x, width - w)), y: CLIP_Y })}
                onDragEnd={onDragEnd}
                onClick={(e) => { e.cancelBubble = true }}
                onMouseDown={(e) => { e.cancelBubble = true; setSelectedId(c.id) }}
              />
              <Text
                x={x + 10} y={CLIP_Y + 18}
                text={c.name}
                fontSize={12}
                fill="#111"
              />
              {/* left handle */}
              <Rect
                x={x - HANDLE_W / 2}
                y={CLIP_Y}
                width={HANDLE_W}
                height={CLIP_H}
                fill="#333"
                opacity={0.6}
                draggable
                dragBoundFunc={(pos) => ({ x: pos.x, y: CLIP_Y })}
                onDragMove={onLeftDragMove}
                onMouseDown={(e) => { e.cancelBubble = true; setSelectedId(c.id) }}
              />
              {/* right handle */}
              <Rect
                x={x + w - HANDLE_W / 2}
                y={CLIP_Y}
                width={HANDLE_W}
                height={CLIP_H}
                fill="#333"
                opacity={0.6}
                draggable
                dragBoundFunc={(pos) => ({ x: pos.x, y: CLIP_Y })}
                onDragMove={onRightDragMove}
                onMouseDown={(e) => { e.cancelBubble = true; setSelectedId(c.id) }}
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

