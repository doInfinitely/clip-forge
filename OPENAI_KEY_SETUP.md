# OpenAI API Key Setup for Production

## The Problem
The `.env` file doesn't get packaged with the built application, so `process.env.OPENAI_API_KEY` won't work in production builds.

## The Solution
The app now stores your OpenAI API key in a persistent settings file in the app's user data directory.

## How It Works

### Development Mode (`npm run dev`)
- The app tries to load `OPENAI_API_KEY` from `.env` first
- If not found, it looks in the settings file
- Create a `.env` file in the project root:
  ```
  OPENAI_API_KEY=sk-your-key-here
  ```

### Production Mode (Built App)
- The app loads the API key from `settings.json` stored in:
  - **macOS**: `~/Library/Application Support/clipforge/settings.json`
  - **Windows**: `%APPDATA%\clipforge\settings.json`
  - **Linux**: `~/.config/clipforge/settings.json`

## Using the Settings UI

1. **Launch the app** (built version or dev mode)

2. **Click the ⚙️ (gear) icon** in the top-right corner of the toolbar

3. **Enter your OpenAI API key** in the settings dialog

4. **Click "Save Settings"**

5. **Your key is now saved** and will work for AI Summarization

## Security Notes

✅ **Your API key is stored locally** on your device only  
✅ **Not transmitted anywhere** except directly to OpenAI's API  
✅ **Not included in backups or git repos**  
❌ **Not encrypted** - standard app settings storage  

For maximum security, consider:
- Using OpenAI's usage limits and quotas
- Creating a separate API key just for this app
- Rotating keys regularly

## Getting an API Key

1. Go to [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. Sign in or create an account
3. Click "Create new secret key"
4. Copy the key (starts with `sk-`)
5. Paste it into ClipForge settings

## Troubleshooting

### "OpenAI API key not configured" error
→ Click the ⚙️ icon and enter your API key in Settings

### Key works in dev but not in production
→ The production build has its own settings file separate from `.env`  
→ Open Settings in the built app and enter the key again

### Where is my key stored?
macOS: `~/Library/Application Support/clipforge/settings.json`  
Windows: `%APPDATA%\clipforge\settings.json`  
Linux: `~/.config/clipforge/settings.json`

### How to remove my key
Delete the `settings.json` file from the location above, or just clear it in the Settings UI

## Technical Details

The app now has:
- `settings-save` IPC handler - saves settings to user data directory
- `settings-load` IPC handler - loads settings from user data directory
- `getOpenAIKey()` helper - tries env var first, then settings file
- Settings UI component - modal dialog for managing API key

This approach ensures the API key works in both development and production without requiring rebuild or env var configuration.

