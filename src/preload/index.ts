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
  exportTimeline: (parts: Array<{inputPath:string; tIn:number; tOut:number}>, crf?: number) =>
    ipcRenderer.invoke('ffmpeg-export-timeline', { parts, reencodeCRF: crf }),
  onFFmpegProgress: (callback: (message: string) => void) => {
    ipcRenderer.on('ffmpeg-progress', (_evt, message) => callback(message))
  },
})

declare global {
  interface Window {
    clipforge: {
      openVideos: () => Promise<string[]>
      saveBytes: (defaultName: string, bytes: Uint8Array) => Promise<{ saved: boolean; path?: string }>
      readFileBytes: (absPath: string) => Promise<Uint8Array>
      ffmpegTrim: (inputPath: string, tIn: number, tOut: number, reencode?: boolean) => Promise<Uint8Array>
      exportTimeline: (parts: Array<{inputPath:string; tIn:number; tOut:number}>, crf?: number) => Promise<Uint8Array>
      onFFmpegProgress: (callback: (message: string) => void) => void
    }
  }
}

