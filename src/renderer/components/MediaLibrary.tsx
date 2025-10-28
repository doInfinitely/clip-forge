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
  onDelete,
}: {
  items: LibraryItem[]
  onDelete?: (id: string) => void
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
              border:'1px solid #ddd', borderRadius:6, overflow:'hidden', background:'#fafafa', cursor:'grab', position:'relative'
            }}
            title={`${it.name}\n${(it.duration).toFixed(2)}s${it.width?` • ${it.width}×${it.height}`:''}`}
          >
            <div style={{ background:'#000', height: 112, display:'flex', alignItems:'center', justifyContent:'center', position:'relative' }}>
              {it.thumb ? (
                <img src={it.thumb} alt={it.name} style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }}/>
              ) : (
                <div style={{ color:'#888', fontSize:12 }}>No preview</div>
              )}
              {/* Delete button */}
              {onDelete && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    e.preventDefault()
                    if (confirm(`Remove "${it.name}" from library?`)) {
                      onDelete(it.id)
                    }
                  }}
                  style={{
                    position: 'absolute',
                    top: 4,
                    right: 4,
                    width: 24,
                    height: 24,
                    borderRadius: 4,
                    border: 'none',
                    background: 'rgba(0,0,0,0.7)',
                    color: '#fff',
                    fontSize: 16,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0,
                    transition: 'background 0.2s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(220, 38, 38, 0.9)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(0,0,0,0.7)'}
                  title="Remove from library"
                >
                  ×
                </button>
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

