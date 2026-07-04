// Runs from postinstall. On Vercel's build VM ONLY (never locally), prune
// onnxruntime assets that can never be used by linux serverless functions:
// darwin/win32 native binaries and the onnxruntime-web wasm blobs (the
// native node backend is used at runtime; the wasm backend loads lazily and
// only if requested). Without this, Vercel packs the entire externalized
// @huggingface/transformers tree into the retrieval functions — 365MB,
// over the 250MB limit — regardless of Next's outputFileTracingExcludes.
import { existsSync, readdirSync, rmSync, statSync } from "fs"
import { join } from "path"

if (process.env.VERCEL !== "1") {
  process.exit(0)
}

const CANDIDATE_ROOTS = [
  "node_modules/onnxruntime-node",
  "node_modules/@huggingface/transformers/node_modules/onnxruntime-node"
]
const WEB_ROOTS = [
  "node_modules/onnxruntime-web",
  "node_modules/@huggingface/transformers/node_modules/onnxruntime-web"
]

let freed = 0

function dirSize(path) {
  let total = 0
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const p = join(path, entry.name)
    total += entry.isDirectory() ? dirSize(p) : statSync(p).size
  }
  return total
}

function prune(path) {
  if (!existsSync(path)) return
  const size = statSync(path).isDirectory() ? dirSize(path) : statSync(path).size
  rmSync(path, { recursive: true, force: true })
  freed += size
  console.log(`prune-onnx: removed ${path} (${(size / 1e6).toFixed(1)}MB)`)
}

for (const root of CANDIDATE_ROOTS) {
  prune(join(root, "bin/napi-v6/darwin"))
  prune(join(root, "bin/napi-v6/win32"))
}

for (const root of WEB_ROOTS) {
  const dist = join(root, "dist")
  if (!existsSync(dist)) continue
  for (const file of readdirSync(dist)) {
    if (file.endsWith(".wasm")) prune(join(dist, file))
  }
}

console.log(`prune-onnx: freed ${(freed / 1e6).toFixed(1)}MB total`)
