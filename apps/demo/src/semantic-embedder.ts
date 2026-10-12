import type { Embedder } from "@setusync/edge-sdk";

/** ~25 MB quantised sentence model. Downloaded once (online), then cached by the browser. */
export const SEMANTIC_MODEL_ID = "Xenova/all-MiniLM-L6-v2";

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function createTransformersEmbedder(onProgress: (percent: number) => void): Promise<Embedder> {
  // Loaded on demand so the main app stays small and the model is only fetched if wanted.
  const tf: any = await import("@huggingface/transformers");

  tf.env.allowLocalModels = false;
  tf.env.useBrowserCache = true;
  // The ONNX runtime files are served by this app (public/ort), so inference works offline.
  if (tf.env.backends?.onnx?.wasm) tf.env.backends.onnx.wasm.wasmPaths = "/ort/";

  const extractor: any = await tf.pipeline("feature-extraction", SEMANTIC_MODEL_ID, {
    dtype: "q8",
    device: "wasm",
    progress_callback: (p: { status?: string; progress?: number }) => {
      if (p.status === "progress" && typeof p.progress === "number") onProgress(Math.round(p.progress));
    },
  });

  return {
    id: SEMANTIC_MODEL_ID,
    embed: async (texts) => {
      const output = await extractor(texts, { pooling: "mean", normalize: true });
      const data = output.data as Float32Array;
      const dims = output.dims[1] as number;
      return texts.map((_, i) => data.slice(i * dims, (i + 1) * dims));
    },
  };
}
