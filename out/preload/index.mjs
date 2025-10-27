import { contextBridge, ipcRenderer } from "electron";
console.log("[preload] exposing clipforge API");
contextBridge.exposeInMainWorld("clipforge", {
  openVideos: () => ipcRenderer.invoke("open-videos"),
  saveBytes: (defaultName, bytes) => ipcRenderer.invoke("save-bytes", { defaultName, bytes }),
  readFileBytes: (absPath) => ipcRenderer.invoke("read-file-bytes", absPath),
  ffmpegTrim: (inputPath, tIn, tOut, reencode = true) => ipcRenderer.invoke("ffmpeg-trim", { inputPath, tIn, tOut, reencode })
});
