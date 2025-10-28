import { contextBridge, ipcRenderer } from "electron";
console.log("[preload] exposing clipforge API");
contextBridge.exposeInMainWorld("clipforge", {
  openVideos: () => ipcRenderer.invoke("open-videos"),
  saveBytes: (defaultName, bytes) => ipcRenderer.invoke("save-bytes", { defaultName, bytes }),
  readFileBytes: (absPath) => ipcRenderer.invoke("read-file-bytes", absPath),
  ffmpegTrim: (inputPath, tIn, tOut, reencode = true) => ipcRenderer.invoke("ffmpeg-trim", { inputPath, tIn, tOut, reencode }),
  exportTimeline: (parts, crf, targetHeight) => ipcRenderer.invoke("ffmpeg-export-timeline", { parts, reencodeCRF: crf, targetHeight }),
  onFFmpegProgress: (callback) => {
    ipcRenderer.on("ffmpeg-progress", (_evt, message) => callback(message));
  },
  projectSave: (data) => ipcRenderer.invoke("project-save", data),
  projectLoad: () => ipcRenderer.invoke("project-load"),
  getDesktopSources: (opts) => ipcRenderer.invoke("get-desktop-sources", opts)
});
