// Copies the ONNX runtime (WebAssembly) into public/ort so semantic search can run
// with no internet once the model has been downloaded. Runs before dev and build.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const roots = [join(here, "..", "node_modules"), join(here, "..", "..", "..", "node_modules")];
const dist = roots.map((r) => join(r, "onnxruntime-web", "dist")).find((d) => existsSync(d));

if (!dist) {
  console.warn("[copy-ort] onnxruntime-web not found; smart search will be unavailable. Run npm install.");
  process.exit(0);
}

const out = join(here, "..", "public", "ort");
mkdirSync(out, { recursive: true });

// transformers.js picks a variant at run time (plain, asyncify, jspi or jsep), so ship them all.
const variants = ["", ".asyncify", ".jspi", ".jsep"];
let copied = 0;
for (const v of variants) {
  for (const ext of [".mjs", ".wasm"]) {
    const file = `ort-wasm-simd-threaded${v}${ext}`;
    if (existsSync(join(dist, file))) {
      copyFileSync(join(dist, file), join(out, file));
      copied += 1;
    }
  }
}
if (copied === 0) console.warn("[copy-ort] no runtime files found in", dist);
console.log("[copy-ort] runtime copied to public/ort");
