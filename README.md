# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react/README.md) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type aware lint rules:

- Configure the top-level `parserOptions` property like this:

```js
export default {
  // other rules...
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    project: ['./tsconfig.json', './tsconfig.node.json'],
    tsconfigRootDir: __dirname,
  },
}
```

- Replace `plugin:@typescript-eslint/recommended` to `plugin:@typescript-eslint/recommended-type-checked` or `plugin:@typescript-eslint/strict-type-checked`
- Optionally add `plugin:@typescript-eslint/stylistic-type-checked`
- Install [eslint-plugin-react](https://github.com/jsx-eslint/eslint-plugin-react) and add `plugin:react/recommended` & `plugin:react/jsx-runtime` to the `extends` list

# ClipForge (Day-1 MVP)


**Stack**: Electron + React (electron-vite) + FFmpeg (WASM)


## Setup
```bash
# Node 18+
npm create electron-vite@latest clipforge --template react
cd clipforge
# Replace boilerplate with the files in this repo (or copy the src/ + configs)
npm i
npm i -D electron-builder
npm i @ffmpeg/ffmpeg @ffmpeg/util
```


## Dev
```bash
npm run dev
```


## Package (local installer)
```bash
npm run dist # creates mac/win artifacts per host OS
```


## Use
1. Click **Import** and choose an MP4/MOV/WebM.
2. Adjust **In/Out** sliders.
3. Click **Export MP4** → choose save location.


## Notes
- We re-encode to H.264/AAC for safe trims regardless of keyframes.
- This satisfies MVP core: launch, import, preview, trim, export, packaged build.
- Next: timeline canvas with multiple clips, split, delete; then recording (desktopCapturer + getUserMedia).
