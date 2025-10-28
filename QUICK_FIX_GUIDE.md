# Quick Fix Guide - FFmpeg "No Audio" Issue

## ✅ What I Fixed

The "no audio" error in production builds was actually an **ffmpeg path problem**, not an audio problem. I've added:

1. **Robust ffmpeg path detection** with multiple fallback strategies
2. **Built-in diagnostic tool** in Settings (⚙️ button)
3. **Detailed logging** to help debug issues
4. **Automatic executable permissions** for ffmpeg binary

## 🚀 Test the Fix Now

### Step 1: Rebuild the App

```bash
./build.sh dist
```

This will create a new distributable in the `dist/` folder.

### Step 2: Install and Run

Install the newly built DMG/app from `dist/`

### Step 3: Test FFmpeg

1. Click the **⚙️ Settings button** (top-right corner)
2. Scroll down to **FFmpeg Diagnostics**
3. Click **"Test FFmpeg"**
4. You should see: **"✅ FFmpeg works!"**

### Step 4: Test AI Summarization

1. Add some video clips to your timeline
2. Set AI Summary percentage (e.g., 30%)
3. Click **"✨ Summarize"**
4. It should now work without the "no audio" error!

## 🔍 If It Still Fails

### Check the Console Logs:

**Option 1: In Dev Mode**
```bash
npm run dev
```
Console logs are visible in the DevTools window.

**Option 2: In Production Build**
- Press `Cmd + Option + I` (macOS) to open DevTools
- Go to Console tab
- Look for messages starting with `[main]` or `[AI Summarize]`

### Look for These Indicators:

✅ **Good**:
```
[main] ✅ ffmpeg ready at: /path/to/ffmpeg
[test-ffmpeg] ✅ FFmpeg works! Version: ffmpeg version ...
```

❌ **Problem**:
```
[main] ❌ ffmpeg binary not found at: /path/to/ffmpeg
[test-ffmpeg] ❌ FFmpeg failed: ...
```

### Share Logs

If the issue persists:
1. Open Settings → Test FFmpeg
2. Copy the error message
3. Open DevTools Console
4. Copy any red errors
5. Share these logs for further debugging

## 📋 What Changed

**Files Modified:**
- `src/main/index.ts` - ffmpeg path handling & diagnostics
- `src/preload/index.ts` - added testFFmpeg API
- `src/renderer/components/Settings.tsx` - added diagnostic UI

**New Build:**
- `out/main/index.js` - compiled with new fixes
- `out/renderer/` - updated Settings UI

## 📚 More Info

- Full troubleshooting: See `FFMPEG_TROUBLESHOOTING.md`
- macOS permissions: See `MACOS_PERMISSIONS.md`  
- API key setup: See `OPENAI_KEY_SETUP.md`
- Complete setup: See `SETUP_COMPLETE.md`

## 💡 Pro Tip

The Settings diagnostic tool is now your go-to for checking if ffmpeg is working. Always test it first before trying AI Summarization in a production build!

---

**TL;DR**: Rebuild with `./build.sh dist`, install the new build, open Settings, click "Test FFmpeg", and you should see ✅!

