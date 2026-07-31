import { cp, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = resolve(projectRoot, "public");
const ocrRoot = resolve(publicRoot, "ocr");

await mkdir(ocrRoot, { recursive: true });

await Promise.all([
  cp(
    resolve(projectRoot, "node_modules/pdfjs-dist/build/pdf.worker.min.mjs"),
    resolve(publicRoot, "pdf.worker.min.mjs"),
  ),
  cp(
    resolve(projectRoot, "node_modules/tesseract.js/dist/worker.min.js"),
    resolve(ocrRoot, "worker.min.js"),
  ),
  cp(
    resolve(
      projectRoot,
      "node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js",
    ),
    resolve(ocrRoot, "tesseract-core-simd-lstm.wasm.js"),
  ),
  cp(
    resolve(
      projectRoot,
      "node_modules/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz",
    ),
    resolve(ocrRoot, "eng.traineddata.gz"),
  ),
]);
