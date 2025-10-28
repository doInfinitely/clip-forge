# macOS Permissions Setup Guide

## What Was Changed

To properly request Camera, Microphone, and Screen Recording permissions on macOS, the following changes were made:

### 1. Entitlements Files
Created two entitlement files for macOS:
- `build/entitlements.mac.plist` - Main app entitlements
- `build/entitlements.mac.inherit.plist` - Helper process entitlements

These files declare the permissions your app needs:
- ✅ `com.apple.security.device.camera` - Camera access
- ✅ `com.apple.security.device.audio-input` - Microphone access  
- ✅ `com.apple.security.screen-capture` - Screen recording access
- ✅ `com.apple.security.network.client` - Network (for AI features)

### 2. Usage Descriptions
Added to `package.json` → `build.mac.extendInfo`:
- **NSCameraUsageDescription** - Explains why camera access is needed
- **NSMicrophoneUsageDescription** - Explains why microphone access is needed
- **NSScreenCaptureUsageDescription** - Explains why screen recording is needed

These descriptions appear in the permission prompt dialogs that macOS shows to users.

### 3. Build Configuration
Updated `package.json` to include:
- `hardenedRuntime: true` - Required for notarization
- `entitlements` and `entitlementsInherit` - Points to the plist files

## Testing the Changes

### For Development (electron-vite dev)
1. **Quit the app completely** if it's running
2. **Reset TCC permissions** (optional but recommended):
   ```bash
   tccutil reset Camera
   tccutil reset Microphone  
   tccutil reset ScreenCapture
   ```

3. **Rebuild and restart**:
   ```bash
   npm run build
   npm run dev
   ```

4. **Trigger permission requests**:
   - Go to the **Webcam** tab and click "Start Recording" → Should prompt for Camera
   - Click "Include microphone" and start → Should prompt for Microphone
   - Go to **Screen Capture** tab and start → Should prompt for Screen Recording

5. **Verify in System Settings**:
   - Open **System Settings** → **Privacy & Security** → **Camera**
   - You should see "Electron" (in dev mode) with a checkbox
   - Same for **Microphone** and **Screen Recording**

### For Production Build
1. **Clean and rebuild**:
   ```bash
   npm run build
   npm run dist
   ```

2. **Install the DMG** from `dist/` folder

3. **Launch the app** and test as above

4. **Verify in System Settings**:
   - The app should appear as "clipforge" (or your productName)
   - All three privacy categories should list it

## Important Notes

### Why Apps Don't Appear Until They Request Access
- macOS **does not** provide a "+" button for Camera/Microphone/Screen Recording
- Apps only appear in the privacy list **after they request permission**
- The first time your app calls `getUserMedia()` or `desktopCapturer.getSources()`, macOS shows a prompt
- After allowing/denying, the app appears in System Settings

### Development vs Production
- In **development** (`npm run dev`), the app appears as "Electron"
- In **production** (built DMG), it appears with your app name
- Each has separate permission entries in System Settings

### If Permissions Get "Stuck"
If macOS doesn't show prompts or the app doesn't appear in settings:

1. **Reset TCC database** (Terminal Command Database):
   ```bash
   tccutil reset Camera
   tccutil reset Microphone
   tccutil reset ScreenCapture
   ```

2. **Quit and restart the app**

3. **For persistent issues**, create a new macOS user account and test there (rules out user-specific corruption)

4. **Boot into Safe Mode** (hold Shift during startup) to rule out third-party interference

### Code Signing (Optional for Development)
For development, code signing is not strictly required, but for distribution:
- macOS requires apps to be **signed** to request certain permissions
- Set up an Apple Developer account and certificate
- Add to `package.json`:
  ```json
  "mac": {
    "identity": "Developer ID Application: Your Name (TEAM_ID)"
  }
  ```

## Troubleshooting

### "App doesn't appear in Camera/Microphone list"
→ Make sure you've triggered the permission request by actually using the feature (click "Start Recording")

### "Permission prompt never shows"
→ Check Console.app for errors. Filter by "clipforge" or "TCC". You may need to reset permissions.

### "Screen Recording doesn't work even after allowing"
→ Restart the app after granting permission. Screen Recording requires a restart.

### "getUserMedia() fails immediately"
→ Check that the entitlements are being applied:
```bash
codesign -d --entitlements - /path/to/clipforge.app
```

## Resources
- [Apple TCC Guide](https://developer.apple.com/documentation/bundleresources/information_property_list/protected_resources)
- [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security)
- [electron-builder macOS Config](https://www.electron.build/configuration/mac)

