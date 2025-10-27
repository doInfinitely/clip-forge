// scripts/copy-ffmpeg-core.mjs
import { createRequire } from 'node:module'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

function pkgRoot(pkg) {
  try {
    const pkgJson = require.resolve(`${pkg}/package.json`)
    return path.dirname(pkgJson)
  } catch {
    return null
  }
}

async function findFiles(root, names) {
  // BFS walk for speed + simplicity
  const out = {}
  const q = [root]
  const seen = new Set([root])
  while (q.length && Object.keys(out).length < names.length) {
    const dir = q.shift()
    let entries = []
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (!seen.has(full)) { seen.add(full); q.push(full) }
      } else if (e.isFile()) {
        if (names.includes(e.name) && !out[e.name]) out[e.name] = full
      }
    }
  }
  return out
}

async function copyFrom(pkg) {
  const root = pkgRoot(pkg)
  if (!root) return false
  const found = await findFiles(root, ['ffmpeg-core.js', 'ffmpeg-core.wasm'])
  if (!found['ffmpeg-core.js'] || !found['ffmpeg-core.wasm']) return false
  const dest = path.join(process.cwd(), 'public', 'ffmpeg')
  await fs.mkdir(dest, { recursive: true })
  await fs.copyFile(found['ffmpeg-core.js'], path.join(dest, 'ffmpeg-core.js'))
  await fs.copyFile(found['ffmpeg-core.wasm'], path.join(dest, 'ffmpeg-core.wasm'))
  console.log(`Copied from ${pkg} → public/ffmpeg/`)
  return true
}

const tried = []
let ok = await copyFrom('@ffmpeg/core'); tried.push('@ffmpeg/core')
if (!ok) { ok = await copyFrom('@ffmpeg/core-mt'); tried.push('@ffmpeg/core-mt') }

if (!ok) {
  console.error(`Could not locate ffmpeg core files in: ${tried.join(', ')}`)
  process.exit(1)
}

