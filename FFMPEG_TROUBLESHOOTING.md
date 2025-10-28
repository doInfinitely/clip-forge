# FFmpeg Troubleshooting Guide - "No Audio" Error in Production

## The Problem

AI Summarization fails in the production build with an error about "no audio" even though your videos have audio tracks.

## Root Cause

This is **not** actually an audio problem - it's an **ffmpeg path** problem! The error occurs because:

1. ffmpeg-static binary isn't being found in the production build
2. The binary exists but isn't executable
3. The asar unpacking isn't working correctly

## ✅ What Was Fixed

### 1. **Improved ffmpeg Path Resolution**
- Added robust path detection with multiple fallback strategies
- Better handling of asar unpacking
- Automatic chmod to make binary executable on Unix/macOS
- Comprehensive logging to debug path issues

### 2. **FFmpeg Diagnostic Tool**
- Added `test-ffmpeg` IPC handler to test ffmpeg availability
- Built-in diagnostics in Settings UI
- Shows exactly what's wrong if ffmpeg fails

### 3. **Enhanced Error Messages**
- AI Summarize now shows detailed ffmpeg spawn errors
- Logs file permissions, paths, and existence checks
- Clear distinction between "ffmpeg not found" vs "video has no audio"

## 🔧 How to Debug

### Step 1: Open Settings and Test FFmpeg

1. **Run your built app**:
   ```bash
   ./build.sh dist
   # Then install and run the DMG
   ```

2. **Click the ⚙️ (gear) icon** in the top-right

3. **Click "Test FFmpeg"** button in the FFmpeg Diagnostics section

4. **Check the result**:
   - ✅ **"FFmpeg works!"** → FFmpeg is fine, the issue is elsewhere
   - ❌ **"FFmpeg failed"** → Shows the exact error and path

### Step 2: Check Console Logs

The app now logs extensive debugging info. To view console logs:

#### In Development Mode:
```bash
npm run dev
```
Console is automatically open in DevTools

#### In Production Build:
Open DevTools with keyboard shortcut:
- **macOS**: `Cmd + Option + I`
- **Windows/Linux**: `Ctrl + Shift + I`

Or add this to your main process temporarily:

```typescript
// In src/main/index.ts, inside createWindow():
win.webContents.openDevTools()
```

### Step 3: Look for These Log Messages

When you start the app, you should see:
```
[main] ffmpeg-static raw path: /path/to/ffmpeg
[main] app.isPackaged: true
[main] ffmpeg path after asar replacement: /path/to/app.asar.unpacked/...
[main] ✅ Made ffmpeg executable
[main] ✅ ffmpeg ready at: /path/to/ffmpeg
```

When testing ffmpeg:
```
[test-ffmpeg] Testing ffmpeg at: /path/to/ffmpeg
[test-ffmpeg] File exists: true
[test-ffmpeg] File mode: 100755
[test-ffmpeg] ✅ FFmpeg works! Version: ffmpeg version N-...
```

When running AI Summarize:
```
[AI Summarize] Using ffmpeg at: /path/to/ffmpeg
[AI Summarize] FFmpeg command: /path/to/ffmpeg -ss 0 -to 30 -i ...
```

### Step 4: Common Issues & Fixes

#### Issue: "ffmpeg binary not found"

**Diagnosis**: The path replacement isn't working.

**Fix 1**: Verify asarUnpack in package.json:
```json
"asarUnpack": [
  "**/node_modules/ffmpeg-static/**"
]
```

**Fix 2**: Check the built app:
```bash
# Navigate to built app
cd dist/mac-arm64/clipforge.app/Contents/Resources/

# Check if ffmpeg is in app.asar.unpacked
ls -la app.asar.unpacked/node_modules/ffmpeg-static/
```

**Fix 3**: Try disabling asar entirely (package.json):
```json
"asar": false
```

#### Issue: "Permission denied" or EACCES

**Diagnosis**: ffmpeg binary isn't executable.

**Fix**: The code now automatically runs `chmod 755` on startup. If this still fails, manually fix it:

```bash
# Find the ffmpeg binary in your built app
cd "dist/mac-arm64/clipforge.app/Contents/Resources/app.asar.unpacked/node_modules/ffmpeg-static"

# Make it executable
chmod +x ffmpeg
```

#### Issue: "Exec format error"

**Diagnosis**: Wrong architecture (e.g., x64 binary on arm64 Mac).

**Fix**: Ensure you're building for the correct architecture:
```json
// package.json
"mac": {
  "target": [
    {
      "target": "dmg",
      "arch": ["arm64", "x64"]  // Build universal or specific arch
    }
  ]
}
```

#### Issue: FFmpeg works but "no audio found" still appears

**Diagnosis**: Now it's actually an audio problem!

**Possible causes**:
1. Video truly has no audio track
2. Audio codec not supported by ffmpeg
3. Audio extraction parameters wrong

**Debug**:
Check if video has audio using ffprobe:
```bash
ffmpeg -i your-video.mp4
# Look for "Audio: " in the output
```

Try manual audio extraction:
```bash
ffmpeg -i your-video.mp4 -vn -ac 1 -ar 16000 -b:a 32k test.mp3
```

## 📋 Quick Checklist

- [ ] Rebuilt app after code changes (`./build.sh`)
- [ ] Installed fresh DMG (not running old version)
- [ ] Opened Settings → Clicked "Test FFmpeg"
- [ ] Checked if FFmpeg test passes
- [ ] Opened DevTools to check console logs
- [ ] Verified ffmpeg path in logs
- [ ] Checked app.asar.unpacked folder exists
- [ ] Verified ffmpeg binary has execute permissions

## 🏗️ Rebuilding for Production

Always use the build script to ensure Node 20:

```bash
# Build the app
./build.sh

# Or build distributable
./build.sh dist
```

Or manually:
```bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm use 20
npm run build
npm run dist
```

## 🔍 Advanced Debugging

### Check Actual ffmpeg Path in Production

Add temporary logging to your app:

```typescript
// In renderer (AI Summarize button click)
console.log('About to call AI Summarize')

// Check what main process sees:
const testResult = await window.clipforge.testFFmpeg()
console.log('FFmpeg test result:', testResult)
```

### Inspect Built App Structure

```bash
cd dist/mac-arm64/clipforge.app/Contents/Resources/

# List all files
find . -name "ffmpeg*"

# Should show:
# ./app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg
# ./app.asar.unpacked/node_modules/ffmpeg-static/index.js
```

### Test ffmpeg Manually

```bash
# Extract the ffmpeg binary
cd "dist/mac-arm64/clipforge.app/Contents/Resources/app.asar.unpacked/node_modules/ffmpeg-static"

# Test it
./ffmpeg -version

# If it works, test audio extraction
./ffmpeg -i /path/to/your/video.mp4 -vn -ac 1 -ar 16000 test.mp3
```

## 📝 Changes Made in This Update

### Files Modified:
- ✅ `src/main/index.ts`:
  - New `getFFmpegPath()` function with robust error handling
  - New `test-ffmpeg` IPC handler
  - Enhanced logging in AI summarize audio extraction
  
- ✅ `src/preload/index.ts`:
  - Added `testFFmpeg` API
  
- ✅ `src/renderer/components/Settings.tsx`:
  - Added FFmpeg Diagnostics section
  - Added "Test FFmpeg" button
  - Shows test results with helpful error messages

### New Features:
- 🔧 FFmpeg diagnostic tool in Settings
- 📊 Detailed logging for debugging
- 🔄 Multiple fallback path strategies
- ⚠️ Clear error messages

## 🎯 Expected Behavior

### After Fix:

1. **App Starts**: 
   ```
   [main] ✅ ffmpeg ready at: /path/to/ffmpeg
   ```

2. **Test FFmpeg**: Click button → "✅ FFmpeg works!"

3. **AI Summarize**: Works without "no audio" errors

## 🆘 Still Not Working?

If you've tried everything above:

1. **Share your logs**:
   - Open DevTools (Cmd+Option+I)
   - Copy all console output
   - Look for any red errors

2. **Check build output**:
   ```bash
   ls -la "dist/mac-arm64/clipforge.app/Contents/Resources/app.asar.unpacked/node_modules/ffmpeg-static/"
   ```

3. **Try without asar** (package.json):
   ```json
   "asar": false
   ```
   This makes debugging easier (but increases app size)

4. **Verify Node version during build**:
   ```bash
   node --version  # Should be v20.x.x
   ```

The improved logging will make it much easier to identify the exact issue!

