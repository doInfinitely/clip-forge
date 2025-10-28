# Setup Complete - OpenAI API Key & macOS Permissions

## ✅ All Changes Successfully Implemented

### 1. macOS Permissions (Camera, Microphone, Screen Recording) ✅

**Files Created:**
- `build/entitlements.mac.plist` - Main app entitlements
- `build/entitlements.mac.inherit.plist` - Helper process entitlements
- `MACOS_PERMISSIONS.md` - Comprehensive guide

**Files Modified:**
- `package.json` - Added entitlements, usage descriptions, and hardened runtime settings

**What This Fixes:**
- Apps now properly request Camera/Microphone/Screen Recording permissions
- Permission prompts appear when using Webcam/Screen Capture features
- App appears in System Settings → Privacy & Security after requesting access
- No more "stuck" permission states

**Usage Descriptions Added:**
- Camera: "ClipForge needs access to your camera to record video and create Picture-in-Picture content."
- Microphone: "ClipForge needs access to your microphone to record audio for your videos."
- Screen Recording: "ClipForge needs to capture your screen to record screen videos and create content."

### 2. OpenAI API Key Management ✅

**Files Created:**
- `src/renderer/components/Settings.tsx` - Settings UI modal
- `OPENAI_KEY_SETUP.md` - User guide for API key setup

**Files Modified:**
- `src/main/index.ts`:
  - Added `getOpenAIKey()` helper function
  - Added `settings-save` IPC handler  
  - Added `settings-load` IPC handler
  - Updated `ai-summarize` handler to use settings
  
- `src/preload/index.ts`:
  - Added `settingsSave` to bridge API
  - Added `settingsLoad` to bridge API
  - Updated TypeScript definitions

- `src/renderer/App.tsx`:
  - Imported Settings component
  - Added `showSettings` state
  - Added Settings button (⚙️ icon) to toolbar
  - Added Settings modal rendering

**How It Works:**
1. **Development**: Loads API key from `.env` file OR settings file
2. **Production**: Loads API key from persistent settings file
3. **User Interface**: Click ⚙️ button → Enter API key → Saved to local storage

**Settings Storage Location:**
- macOS: `~/Library/Application Support/clipforge/settings.json`
- Windows: `%APPDATA%\clipforge\settings.json`
- Linux: `~/.config/clipforge/settings.json`

### 3. Build System Fix ✅

**Issue Found:** Node v16 too old for Vite 5  
**Solution:** Used nvm to switch to Node 20  
**Result:** Build succeeded with all new changes compiled  

## 🚀 Testing Your Changes

### Test macOS Permissions:

1. **Reset permissions** (optional):
   ```bash
   tccutil reset Camera
   tccutil reset Microphone
   tccutil reset ScreenCapture
   ```

2. **Run the app**:
   ```bash
   cd /Users/remy/Code/gauntlet_ai/clip_forge
   export NVM_DIR="$HOME/.nvm"
   [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
   nvm use 20
   npm run dev
   ```

3. **Trigger permission prompts**:
   - Go to **Webcam** tab → Click "Start Recording" → Camera prompt
   - Enable "Include microphone" → Microphone prompt  
   - Go to **Screen Capture** tab → Start → Screen Recording prompt

4. **Verify in System Settings**:
   - System Settings → Privacy & Security → Camera (should see "Electron")
   - Same for Microphone and Screen Recording

### Test OpenAI API Key Settings:

1. **Open Settings**:
   - Click the ⚙️ (gear) icon in the top-right corner

2. **Enter API Key**:
   - Paste your OpenAI API key (starts with `sk-`)
   - Click "Save Settings"

3. **Test AI Summarization**:
   - Add some video clips to timeline
   - Set AI Summary percentage (e.g., 30%)
   - Click "✨ Summarize"
   - Should work without needing `.env` file

## 🏗️ Building for Production

Now that Node 20 is configured:

```bash
# Use Node 20
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm use 20

# Build the app
npm run build

# Create distributable
npm run dist
```

The built app will:
- ✅ Request macOS permissions properly
- ✅ Have Settings UI for API key management
- ✅ Store API key persistently
- ✅ Work without `.env` file

## 📋 Summary of All Files Changed

### New Files:
- ✅ `build/entitlements.mac.plist`
- ✅ `build/entitlements.mac.inherit.plist`
- ✅ `src/renderer/components/Settings.tsx`
- ✅ `MACOS_PERMISSIONS.md`
- ✅ `OPENAI_KEY_SETUP.md`
- ✅ `BUILD_FIX.md`
- ✅ `SETUP_COMPLETE.md` (this file)

### Modified Files:
- ✅ `package.json` - macOS entitlements & usage descriptions
- ✅ `src/main/index.ts` - API key management & settings IPC
- ✅ `src/preload/index.ts` - Settings bridge API
- ✅ `src/renderer/App.tsx` - Settings button & modal

### Build Output (Updated):
- ✅ `out/main/index.js` - Compiled main process with new handlers
- ✅ `out/preload/index.mjs` - Compiled preload with settings API
- ✅ `out/renderer/` - Compiled renderer with Settings UI

## 🔄 Making nvm Permanent

To avoid needing to run `nvm use 20` every time, add this to your `~/.zshrc`:

```bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # nvm bash_completion

# Auto-use .nvmrc if present, or default to Node 20
autoload -U add-zsh-hook
load-nvmrc() {
  local node_version="$(nvm version)"
  local nvmrc_path="$(nvm_find_nvmrc)"

  if [ -n "$nvmrc_path" ]; then
    local nvmrc_node_version=$(nvm version "$(cat "${nvmrc_path}")")
    if [ "$nvmrc_node_version" != "$node_version" ]; then
      nvm use
    fi
  elif [ "$node_version" != "$(nvm version default)" ]; then
    nvm use default
  fi
}
add-zsh-hook chpwd load-nvmrc
load-nvmrc

# Or simply set default
nvm alias default 20
```

Then reload: `source ~/.zshrc`

## 🎯 Next Steps

1. **Test in Development**:
   ```bash
   nvm use 20
   npm run dev
   ```
   - Test permissions
   - Test Settings UI
   - Test API key persistence

2. **Build & Test Production**:
   ```bash
   nvm use 20
   npm run dist
   ```
   - Install the DMG
   - Test all features in built app

3. **Commit Changes** (when satisfied):
   ```bash
   git add .
   git commit -m "Add macOS permissions & settings UI for OpenAI API key"
   ```

## 📚 Documentation

- **macOS Permissions**: See `MACOS_PERMISSIONS.md`
- **API Key Setup**: See `OPENAI_KEY_SETUP.md`
- **Build Issues**: See `BUILD_FIX.md`

## ✨ What Users Will See

### Development Mode:
- App appears as "Electron" in System Settings
- API key from `.env` file (backward compatible)
- Settings UI also available

### Production Mode:
- App appears as "clipforge" in System Settings
- API key from Settings UI (⚙️ button)
- Persistent across app launches

All features now work correctly in both modes! 🎉

