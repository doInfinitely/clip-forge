# Build Error Fix - Node Version Issue

## Problem

The build is failing with this error:
```
TypeError: crypto$2.getRandomValues is not a function
```

This is because **Node v16.13.0 is too old** for Vite 5, which requires Node 18+.

## Solution: Upgrade to Node 18 or 20

### Option 1: Using nvm (Recommended)

Install nvm if you don't have it:
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
```

Then install and use Node 20:
```bash
nvm install 20
nvm use 20
node --version  # Should show v20.x.x
```

Now rebuild:
```bash
npm run build
npm run dist
```

### Option 2: Direct Node Upgrade (macOS)

Using Homebrew:
```bash
brew install node@20
brew link node@20
```

Or download from [nodejs.org](https://nodejs.org/) (LTS version recommended)

### Option 3: Use the Existing Build (Temporary)

The previous build output has been restored to `out/` directory. Your code changes were made but NOT compiled yet. 

To test your changes:
1. Upgrade Node (see options above)
2. Rebuild: `npm run build`
3. Test: `npm run dev` or `npm run dist`

## What Was Changed

Even though the build failed, here are the completed changes:

### 1. **OpenAI API Key Management** ✅
- Added `getOpenAIKey()` helper in `src/main/index.ts`
- Added `settings-save` and `settings-load` IPC handlers
- Updated AI summarize handler to use settings instead of env var only

### 2. **Settings UI** ✅
- Created `src/renderer/components/Settings.tsx`
- Added Settings button (⚙️ icon) to toolbar in `App.tsx`
- Modal dialog for entering/managing API key

### 3. **Preload API** ✅
- Added `settingsSave` and `settingsLoad` to preload bridge

## How It Works

### Development (.env still works):
- Loads `OPENAI_API_KEY` from `.env` file first (backward compatible)
- Falls back to settings file if env var not found

### Production (built app):
- Loads API key from `settings.json` in app's userData directory
- User enters key via Settings UI (⚙️ button)
- Key persists across app launches

### Settings Storage Location:
- **macOS**: `~/Library/Application Support/clipforge/settings.json`
- **Windows**: `%APPDATA%\clipforge\settings.json`
- **Linux**: `~/.config/clipforge/settings.json`

## Testing After Node Upgrade

1. **Rebuild**:
   ```bash
   npm run build
   ```

2. **Test in dev mode**:
   ```bash
   npm run dev
   ```
   - Click the ⚙️ button in top right
   - Enter your OpenAI API key
   - Click "Save Settings"
   - Try the AI Summarize feature

3. **Test production build**:
   ```bash
   npm run dist
   ```
   - Install the DMG/installer
   - Launch the app
   - Open Settings and enter API key
   - Test AI features

## Files Modified

- ✅ `src/main/index.ts` - API key management
- ✅ `src/preload/index.ts` - Settings API
- ✅ `src/renderer/App.tsx` - Settings button & modal
- ✅ `src/renderer/components/Settings.tsx` - NEW file
- ✅ `package.json` - macOS entitlements (from previous fix)
- ✅ `build/entitlements.mac.plist` - Camera/Mic permissions (from previous fix)
- ✅ `build/entitlements.mac.inherit.plist` - Helper entitlements (from previous fix)

## Why This Happened

Vite 5 (used by electron-vite) requires Node 18+ because it uses newer JavaScript APIs like `crypto.getRandomValues`. Node 16 reached end-of-life in September 2023.

The project should probably update its `package.json` to specify the minimum Node version:
```json
"engines": {
  "node": ">=18.0.0"
}
```

