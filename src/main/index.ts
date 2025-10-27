// src/main/index.ts
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'      // add sync for exists check
import { spawn } from 'node:child_process'
import os from 'node:os'
import { createRequire } from 'node:module'

// ✅ Use a differently named require so we don't redeclare `require`
const nodeRequire = createRequire(import.meta.url)
const ffmpegPath = (nodeRequire('ffmpeg-static') as string) || ''

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
      preload: app.isPackaged
        ? path.join(__dirname, '../preload/index.js')
        : path.join(__dirname, '../preload/index.mjs'),
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
    //win.webContents.openDevTools()
  } else {
    // 👇 load the built renderer html
    await win.loadFile(path.join(__dirname, '../renderer/index.html'))
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

