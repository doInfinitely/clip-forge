import React from 'react'

export type LibraryItem = {
  id: string
  name: string
  path: string
  duration: number
  width?: number
  height?: number
  thumb?: string
}

export default function MediaLibrary({
  items,
}: {
  items: LibraryItem[]
}) {
  return (
    <div style={{
      width: 240, borderRight: '1px solid #eee', background:'#fff',
      height: '100%', overflowY:'auto', padding: 8, boxSizing:'border-box'
    }}>
      <div style={{ fontSize:13, fontWeight:700, margin:'4px 0 8px' }}>Media</div>
      <div style={{ display:'grid', gap:8 }}>
        {items.map(it => (
          <div key={it.id}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('application/x-clipforge-media-id', it.id)
              e.dataTransfer.effectAllowed = 'copy'
            }}
            style={{
              border:'1px solid #ddd', borderRadius:6, overflow:'hidden', background:'#fafafa', cursor:'grab'
            }}
            title={`${it.name}\n${(it.duration).toFixed(2)}s${it.width?` • ${it.width}×${it.height}`:''}`}
          >
            <div style={{ background:'#000', height: 112, display:'flex', alignItems:'center', justifyContent:'center' }}>
              {it.thumb ? (
                <img src={it.thumb} alt={it.name} style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }}/>
              ) : (
                <div style={{ color:'#888', fontSize:12 }}>No preview</div>
              )}
            </div>
            <div style={{ padding:'6px 8px' }}>
              <div style={{ fontSize:12, fontWeight:600, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{it.name}</div>
              <div style={{ fontSize:11, color:'#555' }}>
                {(it.duration).toFixed(2)}s{it.width?` • ${it.width}×${it.height}`:''}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

