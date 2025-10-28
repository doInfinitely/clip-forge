// src/main/index.ts
import { app, BrowserWindow, dialog, ipcMain, desktopCapturer } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import { spawn } from 'node:child_process'
import os from 'node:os'
import { createRequire } from 'node:module'
import { Readable } from 'node:stream'
import { OpenAI } from 'openai'
import dotenv from 'dotenv'

// Load environment variables
dotenv.config()

// ✅ Use a differently named require so we don't redeclare `require`
const nodeRequire = createRequire(import.meta.url)
const ffmpegPathRaw = (nodeRequire('ffmpeg-static') as string) || ''
// make sure we point to the unpacked copy in production
const ffmpegPath =
  app.isPackaged
    ? ffmpegPathRaw.replace('app.asar', 'app.asar.unpacked')
    : ffmpegPathRaw

if (!ffmpegPath || !fsSync.existsSync(ffmpegPath)) {
  console.error('[main] ffmpeg-static path not found:', ffmpegPath)
} else {
  // ensure executable (mac/linux)
  fs.chmod(ffmpegPath, 0o755).catch(() => {})
  console.log('[main] ffmpeg path:', ffmpegPath)
}

let win: BrowserWindow | null = null

async function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false, // show after content is ready
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  // helpful diagnostics
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[main] did-fail-load', { code, desc, url })
  })
  win.on('ready-to-show', () => win?.show())

  if (!app.isPackaged) {
    // 👇 load the dev server that electron-vite started
    await win.loadURL(process.env['ELECTRON_RENDERER_URL']!)
    // win.webContents.openDevTools()
  } else {
    // 👇 load the built renderer html - try multiple possible locations
    const candidates = [
      // when renderer is under dist/renderer
      path.join(__dirname, '../../dist/renderer/index.html'),
      // when electron-vite outputs renderer next to main
      path.join(__dirname, '../renderer/index.html'),
      // fallback
      path.join(__dirname, '../../renderer/index.html'),
    ]
    const prodIndex = candidates.find(p => fsSync.existsSync(p))
    console.log('[main] loadFile candidate hit:', prodIndex)
    if (!prodIndex) {
      throw new Error('Renderer index.html not found in expected locations.')
    }
    await win.loadFile(prodIndex)
  }
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })

// ---------------- IPC handlers ----------------

// File open dialog → return file paths
ipcMain.handle('open-videos', async () => {
  console.log('[main] open-videos invoked')
  const result = await dialog.showOpenDialog({
    title: 'Import Videos',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'webm', 'mkv'] }],
  })
  console.log('[main] open-videos result', result)
  return result.canceled ? [] : result.filePaths
})

// Save buffer to a chosen path (Save As)
ipcMain.handle('save-bytes', async (_evt, opts: { defaultName: string, bytes: Uint8Array }) => {
  const result = await dialog.showSaveDialog(win!, {
    title: 'Export MP4',
    defaultPath: opts.defaultName,
    filters: [{ name: 'MP4', extensions: ['mp4'] }],
  })
  if (result.canceled || !result.filePath) return { saved: false }
  await fs.writeFile(result.filePath, Buffer.from(opts.bytes))
  return { saved: true, path: result.filePath }
})

// Read file bytes (for future use if you want it)
ipcMain.handle('read-file-bytes', async (_evt, absPath: string) => {
  const buf = await fs.readFile(absPath)
  return new Uint8Array(buf)
})

// Autosave project
ipcMain.handle('project-save', async (_evt, data: any) => {
  const p = path.join(app.getPath('userData'), 'last_project.json')
  await fs.writeFile(p, JSON.stringify(data))
  return p
})

ipcMain.handle('project-load', async () => {
  const p = path.join(app.getPath('userData'), 'last_project.json')
  try {
    const buf = await fs.readFile(p, 'utf8')
    return JSON.parse(buf)
  } catch { return null }
})

// Get desktop sources for screen recording
ipcMain.handle('get-desktop-sources', async (_evt, opts?: { types?: Array<'screen'|'window'> }) => {
  const sources = await desktopCapturer.getSources({
    types: opts?.types ?? ['screen', 'window'],
    thumbnailSize: { width: 320, height: 200 }
  })
  return sources.map(s => ({
    id: s.id,
    name: s.name,
    thumbnail: s.thumbnail?.toDataURL() ?? null,
  }))
})

// Validate a list of file paths and return only supported video files
ipcMain.handle('import-paths', async (_evt, paths: string[]) => {
  const okExt = new Set(['.mp4','.mov','.webm','.mkv'])
  const out: string[] = []
  for (const p of paths ?? []) {
    try {
      const stat = await fs.stat(p)
      const ext = path.extname(p).toLowerCase()
      if (stat.isFile() && okExt.has(ext)) out.push(p)
    } catch {}
  }
  return out
})

// AI Summarization handler
ipcMain.handle('ai-summarize', async (_evt, args: {
  parts: Array<{ inputPath: string; tIn: number; tOut: number }>,
  targetRatio: number,
  model?: string,
}) => {
  const { parts, targetRatio, model } = args
  
  // Validation
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY not set. Create a .env file in the project root with your API key.')
  }
  if (!parts?.length) throw new Error('No clips provided')
  if (!(targetRatio > 0 && targetRatio < 1)) throw new Error('targetRatio must be between 0 and 1')

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  // 1) Extract audio for each part (mono 16k WAV for OpenAI compatibility)
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipforge_ai_'))
  const audioPaths: string[] = []
  const segmentMaps: Array<{ sourceIndex: number; baseOffset: number }> = []

  let timelineSeconds = 0
  try {
    console.log(`[AI Summarize] Extracting audio from ${parts.length} clips...`)
    for (let i = 0; i < parts.length; i++) {
      console.log(`[AI Summarize] Clip ${i+1}/${parts.length}: ${path.basename(parts[i].inputPath)}`)
    }
    
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]
      const out = path.join(tmpDir, `seg_${i}.mp3`)
      const ffArgs = [
        '-ss', String(p.tIn),
        '-to', String(p.tOut),
        '-i', p.inputPath,
        '-vn',
        '-ac', '1',
        '-ar', '16000',
        '-b:a', '32k',  // Low bitrate to keep file size down
        '-c:a', 'libmp3lame',
        '-y', out
      ]
      
      console.log(`[AI Summarize] Extracting audio ${i+1}/${parts.length}: ${path.basename(p.inputPath)} (${p.tIn.toFixed(2)}s - ${p.tOut.toFixed(2)}s)`)
      
      await new Promise<void>((resolve, reject) => {
        const proc = spawn(ffmpegPath, ffArgs, { stdio: ['ignore','ignore','pipe'] })
        let stderrData = ''
        proc.stderr?.on('data', chunk => stderrData += chunk)
        proc.on('error', reject)
        proc.on('close', c => {
          if (c === 0) {
            resolve()
          } else {
            console.error('[AI Summarize] FFmpeg stderr:', stderrData)
            reject(new Error(`FFmpeg audio extraction failed (exit ${c})`))
          }
        })
      })
      
      // Check if audio file was created and has content
      const stat = await fs.stat(out).catch(() => null)
      if (!stat || stat.size < 1000) {
        console.error(`[AI Summarize] Audio file ${i} is too small or missing. The video might not have audio.`)
        throw new Error(`No audio found in clip ${i+1}. Make sure your videos have audio tracks.`)
      }
      console.log(`[AI Summarize] Audio ${i+1} extracted: ${(stat.size/1024).toFixed(0)} KB`)
      
      const segLen = p.tOut - p.tIn
      audioPaths.push(out)
      segmentMaps.push({ sourceIndex: i, baseOffset: timelineSeconds })
      timelineSeconds += segLen
    }
    
    console.log(`[AI Summarize] Total timeline duration: ${timelineSeconds.toFixed(2)}s`)

    // 2) Transcribe each audio chunk with timestamps
    const transcribeModel = model || 'whisper-1'
    const fullSegments: Array<{ start: number; end: number; text: string }> = []

    for (let i = 0; i < audioPaths.length; i++) {
      const audioPath = audioPaths[i]
      const fileData = await fs.readFile(audioPath)
      
      let tx
      try {
        console.log(`[AI Summarize] Transcribing segment ${i+1}/${audioPaths.length} (${(fileData.length/1024/1024).toFixed(2)} MB)`)
        
        // Create a readable stream for OpenAI (it accepts File or ReadStream)
        const fileStream = fsSync.createReadStream(audioPath) as any
        
        tx = await openai.audio.transcriptions.create({
          file: fileStream,
          model: transcribeModel,
          response_format: 'verbose_json' as any,
        } as any)
        
        console.log(`[AI Summarize] Segment ${i+1} transcription complete.`)
        console.log(`[AI Summarize] Response type:`, typeof tx)
        console.log(`[AI Summarize] Response keys:`, Object.keys(tx || {}))
        console.log(`[AI Summarize] Text length: ${tx?.text?.length || 0}`)
        console.log(`[AI Summarize] Segments:`, (tx as any)?.segments?.length || 0)
        
        // Debug: print first segment if available
        if ((tx as any)?.segments?.[0]) {
          console.log(`[AI Summarize] First segment sample:`, JSON.stringify((tx as any).segments[0]).substring(0, 200))
        }
        
      } catch (err: any) {
        console.error(`[AI Summarize] Transcription failed for segment ${i}:`, err.message)
        console.error('[AI Summarize] Full error:', err)
        console.error('[AI Summarize] Error response:', err.response?.data)
        continue
      }

      // Extract segments with timestamps
      const base = segmentMaps[i].baseOffset
      const segs = ((tx as any)?.segments || []).map((s: any) => ({
        start: base + Number(s.start || 0),
        end:   base + Number(s.end || 0),
        text:  String(s.text || '').trim()
      }))
      
      console.log(`[AI Summarize] Extracted ${segs.length} segments from audio ${i+1}`)
      
      // If no segments but we have text, create one big segment
      if (segs.length === 0 && tx?.text) {
        console.log(`[AI Summarize] No segments in response, but found text. Creating single segment.`)
        const segLen = segmentMaps[i].baseOffset
        segs.push({
          start: base,
          end: base + segLen,
          text: tx.text.trim()
        })
      }
      
      fullSegments.push(...segs)
    }

    console.log(`[AI Summarize] Total segments transcribed: ${fullSegments.length}`)
    
    if (!fullSegments.length) {
      throw new Error('No transcription segments found. The OpenAI transcription returned no segments. This might mean the audio is silent or the API failed.')
    }

    // 3) Use LLM to select the best spans
    const totalDur = timelineSeconds
    const targetDur = Math.max(5, Math.floor(totalDur * targetRatio))

    // Cap segments to avoid huge context
    const MAX_SEGS = 1200
    const cutSegments = fullSegments.slice(0, MAX_SEGS)

    // For high percentages (>40%), use inverse strategy: mark sections to REMOVE
    const useInverseStrategy = targetRatio > 0.4
    
    const systemPrompt = useInverseStrategy ? [
      'You are a ruthless video editor cutting down content for time.',
      `You MUST identify ${Math.floor((1 - targetRatio) * totalDur)} seconds of content to CUT (${((1 - targetRatio) * 100).toFixed(0)}% of ${totalDur}s).`,
      'Mark LARGE continuous sections to remove: tangents, repetitive points, slow explanations, filler, pauses, weak arguments.',
      'Be AGGRESSIVE - each removal should be 20-60 seconds. Remove entire weak segments, not just individual sentences.',
      'The goal is to keep only the strongest, most essential content.',
      `You MUST remove close to ${Math.floor((1 - targetRatio) * totalDur)}s total - this is CRITICAL.`,
      'Return JSON with sections to REMOVE: { "selections": [ {"start": 10.5, "end": 68.2}, {"start": 95.3, "end": 145.8}, ... ] }'
    ].join(' ') : [
      'You are an expert video editor. Given transcript segments with timestamps,',
      `select the BEST ${(targetRatio * 100).toFixed(0)}% of content (${targetDur}s from ${totalDur}s).`,
      'Select LONG, CONTINUOUS spans. Be generous with selection length.',
      'Return JSON: { "selections": [ {"start": 0.0, "end": 5.2}, {"start": 10.5, "end": 15.8}, ... ] }'
    ].join(' ')

    const userPrompt = useInverseStrategy 
      ? `Remove ${Math.floor((1 - targetRatio) * totalDur)} seconds of weak content from this ${totalDur}s transcript:\n` + 
        JSON.stringify({
          total_duration: totalDur,
          must_remove_seconds: Math.floor((1 - targetRatio) * totalDur),
          segments: cutSegments.map(s => ({
            start: Number(s.start.toFixed(2)),
            end: Number(s.end.toFixed(2)),
            text: s.text
          }))
        })
      : JSON.stringify({
          target_seconds: targetDur,
          segments: cutSegments.map(s => ({
            start: Number(s.start.toFixed(2)),
            end: Number(s.end.toFixed(2)),
            text: s.text
          }))
        })

    // Use chat completion with JSON mode
    if (useInverseStrategy) {
      console.log(`[AI Summarize] Using INVERSE strategy: asking LLM to identify ${Math.floor((1 - targetRatio) * totalDur)}s to REMOVE`)
    } else {
      console.log(`[AI Summarize] Using NORMAL strategy: asking LLM to select ${targetDur}s to KEEP`)
    }
    
    const chatResp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      response_format: { type: 'json_object' },
      temperature: useInverseStrategy ? 0.9 : 0.7,  // Even higher temperature for inverse strategy
    })

    const responseText = chatResp.choices[0]?.message?.content || '{}'
    console.log(`[AI Summarize] LLM response length: ${responseText.length} chars`)
    console.log(`[AI Summarize] LLM response preview:`, responseText.substring(0, 500))
    
    let json: any
    try {
      json = JSON.parse(responseText)
    } catch (err) {
      console.error('[AI Summarize] JSON parse error:', err)
      throw new Error('LLM returned invalid JSON')
    }

    console.log(`[AI Summarize] Parsed JSON keys:`, Object.keys(json))
    console.log(`[AI Summarize] Using inverse strategy:`, useInverseStrategy)
    
    // Try multiple possible response formats
    let rawSelections: Array<{ start:number; end:number }> = []
    if (Array.isArray(json?.selections)) {
      rawSelections = json.selections
    } else if (Array.isArray(json?.selected_spans)) {
      rawSelections = json.selected_spans
    } else if (Array.isArray(json?.spans)) {
      rawSelections = json.spans
    } else if (Array.isArray(json?.segments)) {
      rawSelections = json.segments
    }
    
    console.log(`[AI Summarize] Found ${rawSelections.length} ${useInverseStrategy ? 'sections to remove' : 'selections'}`)
    
    if (!rawSelections.length && useInverseStrategy) {
      // If inverse strategy and no removals, keep everything!
      console.log('[AI Summarize] No removals specified, keeping entire timeline')
      rawSelections = [{ start: 0, end: totalDur }]
    } else if (!rawSelections.length) {
      console.error('[AI Summarize] Full JSON:', JSON.stringify(json, null, 2))
      throw new Error('LLM did not select any segments. Check logs for full response.')
    }
    
    // If using inverse strategy, invert the selections (keep everything except removals)
    let selections: Array<{ start:number; end:number }> = []
    if (useInverseStrategy) {
      console.log('[AI Summarize] Inverting selections (converting removals to keeps)...')
      const toRemove = rawSelections
        .map(s => ({ start: Math.max(0, s.start), end: Math.min(totalDur, s.end) }))
        .filter(s => s.end > s.start)
        .sort((a, b) => a.start - b.start)
      
      let lastEnd = 0
      for (const remove of toRemove) {
        if (remove.start > lastEnd) {
          selections.push({ start: lastEnd, end: remove.start })
        }
        lastEnd = Math.max(lastEnd, remove.end)
      }
      // Add final section if any
      if (lastEnd < totalDur) {
        selections.push({ start: lastEnd, end: totalDur })
      }
      
      const totalRemoved = toRemove.reduce((sum, r) => sum + (r.end - r.start), 0)
      const totalKept = selections.reduce((sum, s) => sum + (s.end - s.start), 0)
      console.log(`[AI Summarize] After inversion: ${selections.length} sections to keep`)
      console.log(`[AI Summarize] Removed ${totalRemoved.toFixed(2)}s (${(totalRemoved/totalDur*100).toFixed(1)}%), kept ${totalKept.toFixed(2)}s (${(totalKept/totalDur*100).toFixed(1)}%)`)
    } else {
      selections = rawSelections
    }

    // Clean and enforce ordering
    const cleaned: Array<{ start:number; end:number }> = []
    let used = 0
    let lastEnd = 0
    let skippedShort = 0
    let skippedOverlap = 0
    let skippedBudget = 0
    
    for (const s of selections) {
      const a = Math.max(0, Math.min(totalDur, s.start))
      const b = Math.max(0, Math.min(totalDur, s.end))
      if (!(b > a + 0.25)) {
        skippedShort++
        continue  // at least 0.25s
      }
      if (a < lastEnd) {
        skippedOverlap++
        continue      // no overlaps
      }
      // Very generous budget - allow up to 2x to account for LLM uncertainty
      // We'll trim if needed, but don't want to reject good selections
      if (used + (b - a) > targetDur * 2.0) {
        skippedBudget++
        break
      }
      cleaned.push({ start:a, end:b })
      used += (b - a)
      lastEnd = b
    }

    console.log(`[AI Summarize] Selection filtering: ${selections.length} raw -> ${cleaned.length} cleaned`)
    console.log(`[AI Summarize] Skipped: ${skippedShort} too short, ${skippedOverlap} overlap, ${skippedBudget} over budget`)
    console.log(`[AI Summarize] Initial duration: ${used.toFixed(2)}s (target: ${targetDur}s, ${(used/totalDur*100).toFixed(1)}%)`)

    if (!cleaned.length) {
      throw new Error('No valid segments after filtering')
    }

    // ROLLBACK: If LLM undercut by more than 5%, discard and retry with more aggressive prompt
    if (used < targetDur * 0.95) {
      const shortfall = targetDur - used
      console.log(`[AI Summarize] ❌ ROLLBACK: LLM undercut by ${shortfall.toFixed(0)}s (${((1 - used/targetDur)*100).toFixed(0)}% under target)`)
      console.log(`[AI Summarize] Retrying with MORE AGGRESSIVE prompt...`)
      
      // More aggressive prompt for retry
      const retrySystem = useInverseStrategy
        ? [
            'CRITICAL: You are an expert video editor.',
            `Target: REMOVE exactly ${Math.floor((1 - targetRatio) * totalDur)}s (${Math.round((1-targetRatio)*100)}%) from ${totalDur}s.`,
            'MUST identify LARGE continuous sections (40-90 seconds each) to CUT.',
            'Be RUTHLESS. If uncertain, CUT IT.',
            'Return JSON: { "selections": [ {"start": 10.5, "end": 98.2}, ... ] }'
          ].join(' ')
        : [
            'CRITICAL: You are an expert video editor.',
            `Target: SELECT exactly ${targetDur}s (${Math.round(targetRatio*100)}%) from ${totalDur}s.`,
            'MUST select LONG, CONTINUOUS spans (60-180 seconds each).',
            'Be GENEROUS with selection length. When uncertain, INCLUDE IT.',
            'Return JSON: { "selections": [ {"start": 10.5, "end": 190.2}, ... ] }'
          ].join(' ')
      
      const retryResp = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: retrySystem },
          { role: 'user', content: userPrompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 1.0, // Maximum creativity
      })
      
      const retryJson = JSON.parse(retryResp.choices[0]?.message?.content || '{}')
      let retrySelections = retryJson?.selections || retryJson?.selected_spans || retryJson?.spans || retryJson?.segments || []
      
      if (!retrySelections?.length) {
        console.log(`[AI Summarize] ⚠️ Retry also failed, using original result with expansion...`)
        // Fall through to original expansion logic
      } else {
        console.log(`[AI Summarize] ✅ Retry gave ${retrySelections.length} selections`)
        
        // Re-apply inversion if needed
        if (useInverseStrategy) {
          const toRemove = retrySelections
            .map((s: any) => ({ start: Number(s.start), end: Number(s.end) }))
            .filter((s: any) => s.end > s.start && s.start >= 0)
            .sort((a: any, b: any) => a.start - b.start)
          
          retrySelections = []
          let lastEnd = 0
          for (const remove of toRemove) {
            if (remove.start > lastEnd) {
              retrySelections.push({ start: lastEnd, end: remove.start })
            }
            lastEnd = remove.end
          }
          if (lastEnd < totalDur) {
            retrySelections.push({ start: lastEnd, end: totalDur })
          }
        }
        
        // Re-clean with retry results
        cleaned.length = 0
        used = 0
        lastEnd = 0
        for (const s of retrySelections) {
          const a = Math.max(0, Math.min(totalDur, s.start))
          const b = Math.max(0, Math.min(totalDur, s.end))
          if (!(b > a + 0.25)) continue
          if (a < lastEnd) continue
          if (used + (b - a) > targetDur * 1.5) break  // More generous for retry
          cleaned.push({ start: a, end: b })
          used += (b - a)
          lastEnd = b
        }
        
        console.log(`[AI Summarize] After retry: ${used.toFixed(2)}s (${(used/targetDur*100).toFixed(0)}% of target)`)
      }
    }

    // If LLM was too conservative, expand spans to meet target
    if (used < targetDur * 0.8) {
      console.log(`[AI Summarize] LLM too conservative (${(used/targetDur*100).toFixed(0)}% of target), expanding spans...`)
      
      // Try to expand each span by a proportional amount
      const expansionNeeded = targetDur - used
      const expansionPerSpan = expansionNeeded / cleaned.length
      
      for (let i = 0; i < cleaned.length; i++) {
        const span = cleaned[i]
        const currentLen = span.end - span.start
        const expandBy = Math.min(expansionPerSpan, currentLen * 0.5) // Expand by up to 50% of current length
        
        // Try to expand before
        const newStart = Math.max(i > 0 ? cleaned[i-1].end : 0, span.start - expandBy / 2)
        // Try to expand after
        const newEnd = Math.min(i < cleaned.length - 1 ? cleaned[i+1].start : totalDur, span.end + expandBy / 2)
        
        cleaned[i] = { start: newStart, end: newEnd }
      }
      
      const newUsed = cleaned.reduce((sum, s) => sum + (s.end - s.start), 0)
      console.log(`[AI Summarize] After expansion: ${newUsed.toFixed(2)}s (${(newUsed/totalDur*100).toFixed(1)}%)`)
      used = newUsed
    }
    
    console.log(`[AI Summarize] Final duration: ${used.toFixed(2)}s (target: ${targetDur}s, ${(used/totalDur*100).toFixed(1)}%)`)
    
    // Strategy switching: if normal strategy gave 2x+ target, switch to inverse
    let switchedStrategy = false
    if (!useInverseStrategy && used > targetDur * 2) {
      console.log(`[AI Summarize] Normal strategy gave ${(used/targetDur*100).toFixed(0)}% of target, switching to inverse strategy...`)
      switchedStrategy = true
      
      // Convert current selections to inverse (what to remove)
      const toKeep = cleaned.sort((a, b) => a.start - b.start)
      const toRemove: Array<{ start:number; end:number }> = []
      
      let lastEnd = 0
      for (const keep of toKeep) {
        if (keep.start > lastEnd) {
          toRemove.push({ start: lastEnd, end: keep.start })
        }
        lastEnd = keep.end
      }
      if (lastEnd < totalDur) {
        toRemove.push({ start: lastEnd, end: totalDur })
      }
      
      // Now treat it as if we used inverse from the start
      cleaned.length = 0
      cleaned.push(...toKeep)
      used = toKeep.reduce((sum, s) => sum + (s.end - s.start), 0)
      console.log(`[AI Summarize] After strategy switch: ${used.toFixed(2)}s (${(used/totalDur*100).toFixed(1)}%)`)
    }
    
    // Multi-pass refinement - iterate until within 5% of target
    let iterations = 1
    let consecutiveRollbacks = 0
    const TARGET_TOLERANCE = 1.05  // Allow 5% over target max
    const TARGET_FLOOR = 0.95      // Must be at least 95% of target
    
    // Keep iterating if we're outside the 5% tolerance band (either over or under)
    while ((useInverseStrategy || switchedStrategy) && 
           (used > targetDur * TARGET_TOLERANCE || used < targetDur * TARGET_FLOOR) && 
           iterations < 100) {  // Safety cap at 100 iterations
      iterations++
      
      // Handle OVER target - removal pass
      if (used > targetDur * TARGET_TOLERANCE) {
        console.log(`[AI Summarize] Pass ${iterations}: ${(used/targetDur*100 - 100).toFixed(0)}% OVER target, running removal pass...`)
        
        const overageRatio = (used - targetDur) / used
        // Start conservative (30% of overage) and reduce further with each rollback to avoid over-cutting
        // Gradually increase if we've been too conservative (no rollbacks)
        const baseAggressiveness = Math.min(0.3 + (iterations - 1) * 0.05, 0.8) // 30% → 80% over iterations
        const rollbackPenalty = consecutiveRollbacks * 0.1 // Reduce by 10% for each rollback
        const aggressiveness = Math.max(0.15, baseAggressiveness - rollbackPenalty) // Never go below 15%
        const secondRemovalTarget = Math.floor((used - targetDur) * aggressiveness)
        
        console.log(`[AI Summarize] Pass ${iterations}: Need to remove ${secondRemovalTarget}s from current ${used.toFixed(2)}s (${(aggressiveness*100).toFixed(0)}% of overage, ${consecutiveRollbacks} rollbacks)`)
      
      const secondPrompt = [
        `You already edited this content down to ${used.toFixed(0)}s, but need to cut it to ${targetDur}s.`,
        `Remove ${secondRemovalTarget} more seconds (${(overageRatio * 100).toFixed(0)}% more).`,
        'Mark LARGE sections (30-120s each) to remove: tangents, weaker points, slow explanations.',
        'Return JSON: { "selections": [ {"start": 10.5, "end": 68.2}, ... ] }'
      ].join(' ')
      
      // Build new segment list from current selections
      const currentSegments = cleaned.flatMap((span, idx) => {
        const spanSegments = fullSegments.filter(seg => 
          seg.start >= span.start && seg.end <= span.end
        )
        return spanSegments
      })
      
      const secondUserPrompt = `Remove ${secondRemovalTarget}s from this ${used.toFixed(0)}s edit:\n` + 
        JSON.stringify({
          current_duration: used,
          must_remove_seconds: secondRemovalTarget,
          segments: currentSegments.slice(0, MAX_SEGS).map(s => ({
            start: Number(s.start.toFixed(2)),
            end: Number(s.end.toFixed(2)),
            text: s.text
          }))
        })
      
      const secondResp = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: secondPrompt },
          { role: 'user', content: secondUserPrompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.9,
      })
      
      const secondJson = JSON.parse(secondResp.choices[0]?.message?.content || '{}')
      const secondRemovals: Array<{ start:number; end:number }> = secondJson?.selections || []
      
      console.log(`[AI Summarize] Pass ${iterations}: LLM marked ${secondRemovals.length} more sections to remove`)
      
      if (secondRemovals.length === 0) {
        console.log(`[AI Summarize] Pass ${iterations}: No more removals suggested, stopping`)
        break
      }
      
      // Invert again: remove these sections from current selections
      const toRemove2 = secondRemovals
        .map(s => ({ start: Math.max(0, s.start), end: Math.min(totalDur, s.end) }))
        .filter(s => s.end > s.start)
        .sort((a, b) => a.start - b.start)
      
      const newSelections: Array<{ start:number; end:number }> = []
      for (const keep of cleaned) {
        let currentStart = keep.start
        let currentEnd = keep.end
        
        // Check if any removal overlaps this keep section
        for (const remove of toRemove2) {
          if (remove.end <= currentStart || remove.start >= currentEnd) continue
          
          // Split the keep section around the removal
          if (remove.start > currentStart) {
            newSelections.push({ start: currentStart, end: remove.start })
          }
          currentStart = Math.max(currentStart, remove.end)
        }
        
        if (currentStart < currentEnd) {
          newSelections.push({ start: currentStart, end: currentEnd })
        }
      }
      
      // Check if we cut too much before committing
      const tentativeCleaned = newSelections.filter(s => s.end - s.start >= 0.25)
      const tentativeUsed = tentativeCleaned.reduce((sum, s) => sum + (s.end - s.start), 0)
      
      // Rollback if we cut way too much (more than 10% under target) - RETRY with smaller target
      if (tentativeUsed < targetDur * 0.90) {
        const removed2 = toRemove2.reduce((sum, r) => sum + (r.end - r.start), 0)
        console.log(`[AI Summarize] Pass ${iterations}: Would remove ${removed2.toFixed(2)}s → ${tentativeUsed.toFixed(2)}s (${(tentativeUsed/targetDur*100).toFixed(0)}% of target)`)
        consecutiveRollbacks++
        
        if (consecutiveRollbacks >= 5) {
          console.log(`[AI Summarize] Pass ${iterations}: Too many rollbacks (${consecutiveRollbacks}), accepting current result`)
          break
        }
        
        console.log(`[AI Summarize] Pass ${iterations}: TOO AGGRESSIVE (rollback ${consecutiveRollbacks}/5), retrying with more conservative target...`)
        // Don't update cleaned - keep current state and try again with smaller removal target
        continue
      }
      
        // Successful removal - update cleaned selections and reset rollback counter
        cleaned.length = 0
        cleaned.push(...tentativeCleaned)
        
        used = tentativeUsed
        consecutiveRollbacks = 0  // Reset on success
        const removed2 = toRemove2.reduce((sum, r) => sum + (r.end - r.start), 0)
        console.log(`[AI Summarize] Pass ${iterations}: Removed ${removed2.toFixed(2)}s, now at ${used.toFixed(2)}s (${(used/totalDur*100).toFixed(1)}%)`)
        
      } else {
        // Handle UNDER target - expansion pass
        const shortfall = targetDur - used
        console.log(`[AI Summarize] Pass ${iterations}: Need to add ${shortfall.toFixed(0)}s to current ${used.toFixed(2)}s`)
        
        // Find gaps between current selections
        const gaps: Array<{ start:number; end:number }> = []
        cleaned.sort((a, b) => a.start - b.start)
        
        if (cleaned[0].start > 0) {
          gaps.push({ start: 0, end: cleaned[0].start })
        }
        for (let i = 0; i < cleaned.length - 1; i++) {
          if (cleaned[i+1].start > cleaned[i].end) {
            gaps.push({ start: cleaned[i].end, end: cleaned[i+1].start })
          }
        }
        if (cleaned[cleaned.length - 1].end < totalDur) {
          gaps.push({ start: cleaned[cleaned.length - 1].end, end: totalDur })
        }
        
        console.log(`[AI Summarize] Pass ${iterations}: Found ${gaps.length} gaps to potentially fill`)
        
        if (gaps.length === 0) {
          console.log(`[AI Summarize] Pass ${iterations}: No gaps available for expansion, stopping`)
          break
        }
        
        // Ask LLM to select from gaps
        const gapSegments = gaps.flatMap(gap => {
          return fullSegments.filter(seg => seg.start >= gap.start && seg.end <= gap.end)
        })
        
        const expansionPrompt = [
          'CRITICAL: You are an expert video editor expanding a summary.',
          `Current edit is ${used.toFixed(0)}s but needs to be ${targetDur}s.`,
          `ADD ${shortfall.toFixed(0)}s from the ${gaps.length} gaps between current selections.`,
          'Select CONTINUOUS spans (30-90s each) that add valuable context.',
          'Return JSON: { "selections": [ {"start": 10.5, "end": 68.2}, ... ] }'
        ].join(' ')
        
        const expansionUserPrompt = `Add ${shortfall.toFixed(0)}s from these gaps:\n` + 
          JSON.stringify({
            current_duration: used,
            must_add_seconds: shortfall,
            segments: gapSegments.slice(0, MAX_SEGS).map(s => ({
              start: Number(s.start.toFixed(2)),
              end: Number(s.end.toFixed(2)),
              text: s.text
            }))
          })
        
        const expansionResp = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: expansionPrompt },
            { role: 'user', content: expansionUserPrompt }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.9,
        })
        
        const expansionJson = JSON.parse(expansionResp.choices[0]?.message?.content || '{}')
        const additions: Array<{ start:number; end:number }> = expansionJson?.selections || []
        
        console.log(`[AI Summarize] Pass ${iterations}: LLM suggested ${additions.length} additions`)
        
        if (additions.length === 0) {
          console.log(`[AI Summarize] Pass ${iterations}: No additions suggested, stopping`)
          break
        }
        
        // Merge additions with existing selections
        const allSpans = [...cleaned, ...additions.map(a => ({ 
          start: Math.max(0, Math.min(totalDur, a.start)),
          end: Math.max(0, Math.min(totalDur, a.end))
        }))].sort((a, b) => a.start - b.start)
        
        // Merge overlapping/adjacent spans
        const merged: Array<{ start:number; end:number }> = []
        let current = allSpans[0]
        for (let i = 1; i < allSpans.length; i++) {
          const next = allSpans[i]
          if (next.start <= current.end + 0.5) { // Merge if within 0.5s
            current = { start: current.start, end: Math.max(current.end, next.end) }
          } else {
            if (current.end - current.start >= 0.25) merged.push(current)
            current = next
          }
        }
        if (current.end - current.start >= 0.25) merged.push(current)
        
        const newUsed = merged.reduce((sum, s) => sum + (s.end - s.start), 0)
        const added = newUsed - used
        
        // Update cleaned selections and reset rollback counter
        cleaned.length = 0
        cleaned.push(...merged)
        used = newUsed
        consecutiveRollbacks = 0  // Reset on success
        
        console.log(`[AI Summarize] Pass ${iterations}: Added ${added.toFixed(2)}s, now at ${used.toFixed(2)}s (${(used/totalDur*100).toFixed(1)}%)`)
      }
    }
    
    if (iterations > 1) {
      console.log(`[AI Summarize] Multi-pass complete after ${iterations} iterations: ${used.toFixed(2)}s (${(used/targetDur*100).toFixed(0)}% of target)`)
    }

    // 4) Map global timeline times back to original file parts
    console.log(`[AI Summarize] Mapping ${cleaned.length} selected spans to original clips...`)
    const toExport: Array<{ inputPath:string; tIn:number; tOut:number }> = []
    for (let i = 0; i < cleaned.length; i++) {
      const sel = cleaned[i]
      console.log(`[AI Summarize] Span ${i+1}: ${sel.start.toFixed(2)}s - ${sel.end.toFixed(2)}s (${(sel.end - sel.start).toFixed(2)}s)`)
      let remainStart = sel.start
      let remainEnd = sel.end

      let base = 0
      for (const p of parts) {
        const segLen = p.tOut - p.tIn
        const segStart = base
        const segEnd = base + segLen

        const a = Math.max(remainStart, segStart)
        const b = Math.min(remainEnd, segEnd)
        if (b > a + 0.05) {
          const localIn  = p.tIn + (a - segStart)
          const localOut = p.tIn + (b - segStart)
          console.log(`[AI Summarize]   -> ${path.basename(p.inputPath)}: ${localIn.toFixed(2)}s - ${localOut.toFixed(2)}s (${(localOut - localIn).toFixed(2)}s)`)
          toExport.push({ inputPath: p.inputPath, tIn: localIn, tOut: localOut })
        }
        base += segLen
        if (base >= remainEnd) break
      }
    }
    
    const totalExportDuration = toExport.reduce((sum, p) => sum + (p.tOut - p.tIn), 0)
    console.log(`[AI Summarize] Mapped to ${toExport.length} export segments, total duration: ${totalExportDuration.toFixed(2)}s`)

    // 5) Export using the same logic as ffmpeg-export-timeline
    console.log(`[AI Summarize] Starting FFmpeg export of ${toExport.length} segments...`)
    const exportTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipforge_export_'))
    const segmentOuts: string[] = []

    for (let i = 0; i < toExport.length; i++) {
      const p = toExport[i]
      const out = path.join(exportTmpDir, `seg_${i}.mp4`)
      console.log(`[AI Summarize] Encoding segment ${i+1}/${toExport.length}: ${(p.tOut - p.tIn).toFixed(2)}s from ${path.basename(p.inputPath)}`)
      
      // CRITICAL: -i BEFORE -ss for accurate seeking, use -t for duration
      // Try FAST mode first (stream copy), fall back to re-encode if it fails
      const duration = p.tOut - p.tIn
      const fastArgs = [
        '-i', p.inputPath,
        '-ss', String(p.tIn),
        '-t', String(duration),
        '-avoid_negative_ts', 'make_zero',  // Reset timestamps to zero
        '-c', 'copy',                       // Stream copy (no re-encoding)
        '-movflags', '+faststart',
        '-y', out,
      ]
      
      const slowArgs = [
        '-i', p.inputPath,
        '-ss', String(p.tIn),
        '-t', String(duration),
        '-avoid_negative_ts', 'make_zero',
        '-fflags', '+genpts',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '22',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-af', 'aresample=async=1',
        '-vsync', 'cfr',
        '-r', '30',
        '-movflags', '+faststart',
        '-y', out,
      ]
      
      // Try fast mode first (stream copy)
      let success = false
      try {
        await new Promise<void>((resolve, reject) => {
          const proc = spawn(ffmpegPath, fastArgs, { stdio: ['ignore', 'ignore', 'pipe'] })
          proc.on('error', reject)
          proc.on('close', code => code === 0 ? resolve() : reject(new Error(`fast mode failed`)))
        })
        success = true
        if (i === 0) console.log(`[AI Summarize] Using FAST mode (stream copy) for segments`)
      } catch (fastErr) {
        // Fast mode failed, fall back to re-encode
        if (i === 0) console.log(`[AI Summarize] Fast mode failed, using re-encode mode for all segments`)
        await new Promise<void>((resolve, reject) => {
          const proc = spawn(ffmpegPath, slowArgs, { stdio: ['ignore', 'ignore', 'pipe'] })
          proc.on('error', reject)
          proc.on('close', code => code === 0 ? resolve() : reject(new Error(`re-encode exit ${code}`)))
        })
      }
      segmentOuts.push(out)
    }

    // Concatenate
    console.log(`[AI Summarize] Creating concat list with ${segmentOuts.length} segments...`)
    const listPath = path.join(exportTmpDir, 'list.txt')
    const listBody = segmentOuts.map(o => `file '${o.replace(/'/g, "'\\''")}'`).join('\n')
    await fs.writeFile(listPath, listBody)
    const listLines = listBody.split('\n')
    console.log(`[AI Summarize] Concat list (first 5 and last 5):\n${listLines.slice(0, 5).join('\n')}\n... (${listLines.length - 10} more) ...\n${listLines.slice(-5).join('\n')}`)

    const finalPath = path.join(exportTmpDir, `summary_${Date.now()}.mp4`)
    console.log(`[AI Summarize] Concatenating ${segmentOuts.length} segments...`)
    
    // Verify concat list doesn't have duplicates
    const uniqueSegs = new Set(segmentOuts)
    if (uniqueSegs.size !== segmentOuts.length) {
      console.log(`[AI Summarize] ⚠️ WARNING: Duplicate segments detected! ${segmentOuts.length} segments, ${uniqueSegs.size} unique`)
    }
    
    // Try FAST concat first (copy), fall back to re-encode if needed
    const fastConcatArgs = [
      '-f', 'concat',
      '-safe', '0',
      '-i', listPath,
      '-c', 'copy',
      '-movflags', '+faststart',
      '-y', finalPath
    ]
    
    const slowConcatArgs = [
      '-f', 'concat',
      '-safe', '0',
      '-i', listPath,
      '-avoid_negative_ts', 'make_zero',
      '-fflags', '+genpts',
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '20',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-af', 'aresample=async=1',
      '-vsync', 'cfr',
      '-r', '30',
      '-max_muxing_queue_size', '1024',
      '-movflags', '+faststart',
      '-y', finalPath
    ]
    
    let concatSuccess = false
    try {
      console.log(`[AI Summarize] Trying FAST concat (stream copy)...`)
      await new Promise<void>((resolve, reject) => {
        let stderrData = ''
        const proc = spawn(ffmpegPath, fastConcatArgs, { stdio: ['ignore', 'ignore', 'pipe'] })
        
        proc.stderr?.on('data', (chunk) => {
          stderrData += chunk.toString()
        })
        
        proc.on('error', reject)
        proc.on('close', code => {
          if (code !== 0) {
            reject(new Error(`fast concat failed`))
          } else {
            const allMatches = Array.from(stderrData.matchAll(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/g))
            if (allMatches.length > 0) {
              const lastMatch = allMatches[allMatches.length - 1]
              const hours = parseInt(lastMatch[1])
              const mins = parseInt(lastMatch[2])
              const secs = parseFloat(lastMatch[3])
              const totalSecs = hours * 3600 + mins * 60 + secs
              console.log(`[AI Summarize] FAST concat succeeded! Duration: ${totalSecs.toFixed(2)}s`)
            }
            resolve()
          }
        })
      })
      concatSuccess = true
    } catch (fastConcatErr) {
      console.log(`[AI Summarize] Fast concat failed, re-encoding for A/V sync...`)
      await new Promise<void>((resolve, reject) => {
        let stderrData = ''
        const proc = spawn(ffmpegPath, slowConcatArgs, { stdio: ['ignore', 'ignore', 'pipe'] })
        
        proc.stderr?.on('data', (chunk) => {
          stderrData += chunk.toString()
        })
        
        proc.on('error', reject)
        proc.on('close', code => {
          if (code !== 0) {
            console.log(`[AI Summarize] FFmpeg concat stderr (last 500 chars):\n${stderrData.slice(-500)}`)
            reject(new Error(`concat exit ${code}`))
          } else {
            const allMatches = Array.from(stderrData.matchAll(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/g))
            if (allMatches.length > 0) {
              const lastMatch = allMatches[allMatches.length - 1]
              const hours = parseInt(lastMatch[1])
              const mins = parseInt(lastMatch[2])
              const secs = parseFloat(lastMatch[3])
              const totalSecs = hours * 3600 + mins * 60 + secs
              console.log(`[AI Summarize] Re-encode concat completed. Duration: ${totalSecs.toFixed(2)}s (from ${allMatches.length} progress updates)`)
            }
            resolve()
          }
        })
      })
    }

    const finalBytes = await fs.readFile(finalPath)
    console.log(`[AI Summarize] Final video size: ${(finalBytes.length / 1024 / 1024).toFixed(2)} MB`)

    // Cleanup temp files
    for (const p of [...audioPaths, ...segmentOuts, listPath, finalPath]) {
      await fs.unlink(p).catch(() => {})
    }
    await fs.rmdir(tmpDir).catch(() => {})
    await fs.rmdir(exportTmpDir).catch(() => {})

    // 6) Save dialog
    const result = await dialog.showSaveDialog(win!, {
      title: 'Save AI Summary',
      defaultPath: `ai-summary-${Math.round(targetRatio*100)}pct.mp4`,
      filters: [{ name: 'MP4', extensions: ['mp4'] }]
    })

    if (result.canceled || !result.filePath) {
      return { saved: false }
    }

    await fs.writeFile(result.filePath, finalBytes)
    return { saved: true, path: result.filePath }

  } catch (error: any) {
    // Cleanup on error
    try {
      for (const p of audioPaths) {
        await fs.unlink(p).catch(() => {})
      }
      await fs.rmdir(tmpDir).catch(() => {})
    } catch {}
    throw error
  }
})

// Trim a clip using native FFmpeg (ffmpeg-static)
ipcMain.handle('ffmpeg-trim', async (_evt, args: {
  inputPath: string, tIn: number, tOut: number, reencode?: boolean
}) => {
  const { inputPath, tIn, tOut, reencode = true } = args

  if (!inputPath) throw new Error('No inputPath')
  if (!Number.isFinite(tIn) || !Number.isFinite(tOut) || tOut <= tIn) {
    throw new Error(`Invalid trim range: tIn=${tIn} tOut=${tOut}`)
  }

  const tmpOut = path.join(os.tmpdir(), `clipforge_${Date.now()}.mp4`)

  const ffArgs = reencode
    ? [
        '-ss', String(tIn),
        '-to', String(tOut),
        '-i', inputPath,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
        '-c:a', 'aac',
        '-movflags', '+faststart',
        '-y', tmpOut,
      ]
    : [
        '-ss', String(tIn),
        '-to', String(tOut),
        '-i', inputPath,
        '-c', 'copy',
        '-y', tmpOut,
      ]

  await new Promise<void>((resolve, reject) => {
    const p = spawn(ffmpegPath, ffArgs, { stdio: ['ignore', 'pipe', 'pipe'] })
    p.on('error', reject)
    p.on('close', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`)))
  })

  const bytes = await fs.readFile(tmpOut)
  await fs.unlink(tmpOut).catch(() => {}) // best effort
  return new Uint8Array(bytes)
})

// Export timeline (multi-clip)
ipcMain.handle('ffmpeg-export-timeline', async (_evt, args: {
  parts: Array<{ inputPath: string; tIn: number; tOut: number }>,
  reencodeCRF?: number,
  targetHeight?: number // 0 or undefined => source
}) => {
  const { parts, reencodeCRF = 23, targetHeight = 0 } = args
  if (!parts?.length) throw new Error('No parts')

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipforge_'))
  const outs: string[] = []

  // 1) trim each segment to unified codec (+ optional scale)
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    const out = path.join(tmpDir, `seg_${i}.mp4`)
    
    // CRITICAL: -i BEFORE -ss for accurate seeking, use -t for duration
    const duration = p.tOut - p.tIn
    
    // If scaling is required, must re-encode
    const mustReencode = targetHeight > 0
    
    const fastArgs = [
      '-i', p.inputPath,
      '-ss', String(p.tIn),
      '-t', String(duration),
      '-avoid_negative_ts', 'make_zero',
      '-c', 'copy',
      '-movflags', '+faststart',
      '-y', out,
    ]
    
    const slowArgs = targetHeight > 0
      ? [
          '-i', p.inputPath,
          '-ss', String(p.tIn),
          '-t', String(duration),
          '-avoid_negative_ts', 'make_zero',
          '-fflags', '+genpts',
          '-vf', `scale=-2:${targetHeight}`,
          '-c:v', 'libx264',
          '-preset', 'veryfast',
          '-crf', String(reencodeCRF),
          '-c:a', 'aac',
          '-b:a', '192k',
          '-af', 'aresample=async=1',
          '-vsync', 'cfr',
          '-r', '30',
          '-movflags', '+faststart',
          '-y', out,
        ]
      : [
          '-i', p.inputPath,
          '-ss', String(p.tIn),
          '-t', String(duration),
          '-avoid_negative_ts', 'make_zero',
          '-fflags', '+genpts',
          '-c:v', 'libx264',
          '-preset', 'veryfast',
          '-crf', String(reencodeCRF),
          '-c:a', 'aac',
          '-b:a', '192k',
          '-af', 'aresample=async=1',
          '-vsync', 'cfr',
          '-r', '30',
          '-movflags', '+faststart',
          '-y', out,
        ]
    
    // Try fast mode first unless scaling is required
    if (!mustReencode) {
      try {
        await new Promise<void>((resolve, reject) => {
          const proc = spawn(ffmpegPath, fastArgs, { stdio: ['ignore', 'ignore', 'pipe'] })
          proc.on('error', reject)
          proc.on('close', code => code === 0 ? resolve() : reject(new Error(`fast mode failed`)))
        })
        if (i === 0) console.log(`[Export] Using FAST mode (stream copy) for segments`)
        outs.push(out)
        continue
      } catch (fastErr) {
        if (i === 0) console.log(`[Export] Fast mode failed, using re-encode mode for all segments`)
      }
    }
    
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(ffmpegPath, slowArgs, { stdio: ['ignore', 'ignore', 'pipe'] })
      let stderrData = ''
      proc.stderr?.on('data', (chunk) => {
        stderrData += chunk.toString()
        // Send progress updates to renderer
        const lines = stderrData.split('\n')
        for (const line of lines) {
          if (line.includes('frame=') || line.includes('time=')) {
            win?.webContents.send('ffmpeg-progress', `Segment ${i + 1}/${parts.length}: ${line.trim()}`)
          }
        }
      })
      proc.on('error', reject)
      proc.on('close', code => code === 0 ? resolve() : reject(new Error(`trim exit ${code}`)))
    })
    outs.push(out)
  }

  // 2) write concat list
  const listPath = path.join(tmpDir, 'list.txt')
  const body = outs.map(o => `file '${o.replace(/'/g, "'\\''")}'`).join('\n')
  await fs.writeFile(listPath, body)

  // 3) concat - try fast mode first
  const finalPath = path.join(tmpDir, `final_${Date.now()}.mp4`)
  
  const fastConcatArgs = [
    '-f', 'concat',
    '-safe', '0',
    '-i', listPath,
    '-c', 'copy',
    '-movflags', '+faststart',
    '-y', finalPath
  ]
  
  const slowConcatArgs = [
    '-f', 'concat',
    '-safe', '0',
    '-i', listPath,
    '-avoid_negative_ts', 'make_zero',
    '-fflags', '+genpts',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', String(reencodeCRF),
    '-c:a', 'aac',
    '-b:a', '192k',
    '-af', 'aresample=async=1',
    '-vsync', 'cfr',
    '-r', '30',
    '-max_muxing_queue_size', '1024',
    '-movflags', '+faststart',
    '-y', finalPath
  ]
  
  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(ffmpegPath, fastConcatArgs, { stdio: ['ignore', 'ignore', 'pipe'] })
      proc.stderr?.on('data', (chunk) => {
        win?.webContents.send('ffmpeg-progress', `Concatenating (fast): ${chunk.toString().trim()}`)
      })
      proc.on('error', reject)
      proc.on('close', code => code === 0 ? resolve() : reject(new Error(`fast concat failed`)))
    })
  } catch (fastErr) {
    console.log('[Export] Fast concat failed, re-encoding...')
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(ffmpegPath, slowConcatArgs, { stdio: ['ignore', 'ignore', 'pipe'] })
      proc.stderr?.on('data', (chunk) => {
        win?.webContents.send('ffmpeg-progress', `Concatenating (re-encode): ${chunk.toString().trim()}`)
      })
      proc.on('error', reject)
      proc.on('close', code => code === 0 ? resolve() : reject(new Error(`concat exit ${code}`)))
    })
  }

  const bytes = await fs.readFile(finalPath)
  // best-effort cleanup
  outs.forEach(p => fs.unlink(p).catch(()=>{}))
  fs.unlink(listPath).catch(()=>{})
  fs.unlink(finalPath).catch(()=>{})
  fs.rmdir(tmpDir).catch(()=>{})

  return new Uint8Array(bytes)
})

