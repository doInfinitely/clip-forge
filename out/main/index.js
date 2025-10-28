import { app, BrowserWindow, ipcMain, dialog } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import { spawn } from "node:child_process";
import os from "node:os";
import { createRequire } from "node:module";
import __cjs_mod__ from "node:module";
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require2 = __cjs_mod__.createRequire(import.meta.url);
const nodeRequire = createRequire(import.meta.url);
const ffmpegPathRaw = nodeRequire("ffmpeg-static") || "";
const ffmpegPath = app.isPackaged ? ffmpegPathRaw.replace("app.asar", "app.asar.unpacked") : ffmpegPathRaw;
if (!ffmpegPath || !fsSync.existsSync(ffmpegPath)) {
  console.error("[main] ffmpeg-static path not found:", ffmpegPath);
} else {
  fs.chmod(ffmpegPath, 493).catch(() => {
  });
  console.log("[main] ffmpeg path:", ffmpegPath);
}
let win = null;
async function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    // show after content is ready
    webPreferences: {
      preload: app.isPackaged ? path.join(__dirname, "../preload/index.js") : path.join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    console.error("[main] did-fail-load", { code, desc, url });
  });
  win.on("ready-to-show", () => win?.show());
  if (!app.isPackaged) {
    await win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    const candidates = [
      // when renderer is under dist/renderer
      path.join(__dirname, "../../dist/renderer/index.html"),
      // when electron-vite outputs renderer next to main
      path.join(__dirname, "../renderer/index.html"),
      // fallback
      path.join(__dirname, "../../renderer/index.html")
    ];
    const prodIndex = candidates.find((p) => fsSync.existsSync(p));
    console.log("[main] loadFile candidate hit:", prodIndex);
    if (!prodIndex) {
      throw new Error("Renderer index.html not found in expected locations.");
    }
    await win.loadFile(prodIndex);
  }
}
app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
ipcMain.handle("open-videos", async () => {
  console.log("[main] open-videos invoked");
  const result = await dialog.showOpenDialog({
    title: "Import Videos",
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "Video", extensions: ["mp4", "mov", "webm", "mkv"] }]
  });
  console.log("[main] open-videos result", result);
  return result.canceled ? [] : result.filePaths;
});
ipcMain.handle("save-bytes", async (_evt, opts) => {
  const result = await dialog.showSaveDialog(win, {
    title: "Export MP4",
    defaultPath: opts.defaultName,
    filters: [{ name: "MP4", extensions: ["mp4"] }]
  });
  if (result.canceled || !result.filePath) return { saved: false };
  await fs.writeFile(result.filePath, Buffer.from(opts.bytes));
  return { saved: true, path: result.filePath };
});
ipcMain.handle("read-file-bytes", async (_evt, absPath) => {
  const buf = await fs.readFile(absPath);
  return new Uint8Array(buf);
});
ipcMain.handle("ffmpeg-trim", async (_evt, args) => {
  const { inputPath, tIn, tOut, reencode = true } = args;
  if (!inputPath) throw new Error("No inputPath");
  if (!Number.isFinite(tIn) || !Number.isFinite(tOut) || tOut <= tIn) {
    throw new Error(`Invalid trim range: tIn=${tIn} tOut=${tOut}`);
  }
  const tmpOut = path.join(os.tmpdir(), `clipforge_${Date.now()}.mp4`);
  const ffArgs = reencode ? [
    "-ss",
    String(tIn),
    "-to",
    String(tOut),
    "-i",
    inputPath,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    "-y",
    tmpOut
  ] : [
    "-ss",
    String(tIn),
    "-to",
    String(tOut),
    "-i",
    inputPath,
    "-c",
    "copy",
    "-y",
    tmpOut
  ];
  await new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, ffArgs, { stdio: ["ignore", "pipe", "pipe"] });
    p.on("error", reject);
    p.on("close", (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`)));
  });
  const bytes = await fs.readFile(tmpOut);
  await fs.unlink(tmpOut).catch(() => {
  });
  return new Uint8Array(bytes);
});
ipcMain.handle("ffmpeg-export-timeline", async (_evt, args) => {
  const { parts, reencodeCRF = 23 } = args;
  if (!parts?.length) throw new Error("No parts");
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipforge_"));
  const outs = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const out = path.join(tmpDir, `seg_${i}.mp4`);
    const ffArgs = [
      "-ss",
      String(p.tIn),
      "-to",
      String(p.tOut),
      "-i",
      p.inputPath,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      String(reencodeCRF),
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      "-y",
      out
    ];
    await new Promise((resolve, reject) => {
      const proc = spawn(ffmpegPath, ffArgs, { stdio: ["ignore", "ignore", "pipe"] });
      let stderrData = "";
      proc.stderr?.on("data", (chunk) => {
        stderrData += chunk.toString();
        const lines = stderrData.split("\n");
        for (const line of lines) {
          if (line.includes("frame=") || line.includes("time=")) {
            win?.webContents.send("ffmpeg-progress", `Segment ${i + 1}/${parts.length}: ${line.trim()}`);
          }
        }
      });
      proc.on("error", reject);
      proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`trim exit ${code}`)));
    });
    outs.push(out);
  }
  const listPath = path.join(tmpDir, "list.txt");
  const body = outs.map((o) => `file '${o.replace(/'/g, "'\\''")}'`).join("\n");
  await fs.writeFile(listPath, body);
  const finalPath = path.join(tmpDir, `final_${Date.now()}.mp4`);
  await new Promise((resolve, reject) => {
    const args2 = ["-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", "-y", finalPath];
    const proc = spawn(ffmpegPath, args2, { stdio: ["ignore", "ignore", "pipe"] });
    proc.stderr?.on("data", (chunk) => {
      win?.webContents.send("ffmpeg-progress", `Concatenating: ${chunk.toString().trim()}`);
    });
    proc.on("error", reject);
    proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`concat exit ${code}`)));
  });
  const bytes = await fs.readFile(finalPath);
  outs.forEach((p) => fs.unlink(p).catch(() => {
  }));
  fs.unlink(listPath).catch(() => {
  });
  fs.unlink(finalPath).catch(() => {
  });
  fs.rmdir(tmpDir).catch(() => {
  });
  return new Uint8Array(bytes);
});
