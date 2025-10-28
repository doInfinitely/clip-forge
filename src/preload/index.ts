import { contextBridge, ipcRenderer } from 'electron'

console.log('[preload] exposing clipforge API')

contextBridge.exposeInMainWorld('clipforge', {
  openVideos: (): Promise<string[]> => ipcRenderer.invoke('open-videos'),
  saveBytes: (defaultName: string, bytes: Uint8Array) =>
    ipcRenderer.invoke('save-bytes', { defaultName, bytes }),
  readFileBytes: (absPath: string): Promise<Uint8Array> =>
    ipcRenderer.invoke('read-file-bytes', absPath),
  ffmpegTrim: (inputPath: string, tIn: number, tOut: number, reencode = true): Promise<Uint8Array> =>
    ipcRenderer.invoke('ffmpeg-trim', { inputPath, tIn, tOut, reencode }),
  exportTimeline: (parts: Array<{inputPath:string; tIn:number; tOut:number}>, crf?: number, targetHeight?: number) =>
    ipcRenderer.invoke('ffmpeg-export-timeline', { parts, reencodeCRF: crf, targetHeight }),
  onFFmpegProgress: (callback: (message: string) => void) => {
    ipcRenderer.on('ffmpeg-progress', (_evt, message) => callback(message))
  },
  projectSave: (data: any) => ipcRenderer.invoke('project-save', data),
  projectLoad: () => ipcRenderer.invoke('project-load'),
  settingsSave: (settings: { openaiApiKey?: string }) => ipcRenderer.invoke('settings-save', settings),
  settingsLoad: () => ipcRenderer.invoke('settings-load'),
  getDesktopSources: (opts?: { types?: Array<'screen'|'window'> }) =>
    ipcRenderer.invoke('get-desktop-sources', opts),
  importPaths: (paths: string[]) => ipcRenderer.invoke('import-paths', paths),
  aiSummarize: (args: {
    parts: Array<{ inputPath: string; tIn: number; tOut: number }>,
    targetRatio: number,
    model?: string
  }) => ipcRenderer.invoke('ai-summarize', args),
})

declare global {
  interface Window {
    clipforge: {
      openVideos: () => Promise<string[]>
      saveBytes: (defaultName: string, bytes: Uint8Array) => Promise<{ saved: boolean; path?: string }>
      readFileBytes: (absPath: string) => Promise<Uint8Array>
      ffmpegTrim: (inputPath: string, tIn: number, tOut: number, reencode?: boolean) => Promise<Uint8Array>
      exportTimeline: (parts: Array<{inputPath:string; tIn:number; tOut:number}>, crf?: number, targetHeight?: number) => Promise<Uint8Array>
      onFFmpegProgress: (callback: (message: string) => void) => void
      projectSave: (data: any) => Promise<string>
      projectLoad: () => Promise<any>
      settingsSave: (settings: { openaiApiKey?: string }) => Promise<boolean>
      settingsLoad: () => Promise<{ openaiApiKey?: string }>
      getDesktopSources: (opts?: { types?: Array<'screen'|'window'> }) => Promise<Array<{
        id: string; name: string; thumbnail: string | null
      }>>
      importPaths: (paths: string[]) => Promise<string[]>
      aiSummarize: (args: {
        parts: Array<{ inputPath: string; tIn: number; tOut: number }>,
        targetRatio: number,
        model?: string
      }) => Promise<{ saved: boolean; path?: string }>
    }
  }
}

