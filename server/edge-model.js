// 手機上的小模型（E3，ADR-0014）的檔案：只開放白名單，不開放整個 node_modules 或模型資料夾。
//   /vendor/transformers.min.js、/vendor/ort-wasm-simd-threaded.asyncify.mjs：程式（App 打包時也放進 dist/app/vendor/）
//   /edge-model/ort-wasm-simd-threaded.asyncify.wasm：執行環境（約 27 MB，使用者按下載才抓）
//   /edge-model/Xenova/multilingual-e5-small/…：模型（約 135 MB；與伺服器判斷層 JUDGE_MODEL_DIR 同一份）
// 模型不在（沒裝選用依賴、JUDGE_MODEL_DIR 沒下載）就回 null（404），手機畫面說「這台伺服器沒有提供」。
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { EMBED_MODEL, EMBED_FILES } from '../core/judge-classify.js';

const nm = (p) => fileURLToPath(new URL(`../node_modules/${p}`, import.meta.url));
import { ORT_WASM, ORT_MJS } from '../public/js/edge-embed-files.js';
export { ORT_WASM, ORT_MJS };
/** /vendor/ 的程式檔（與 GSAP 同一個路徑；App 打包時複製） */
export const EDGE_VENDOR = { 'transformers.min.js': nm('@huggingface/transformers/dist/transformers.min.js'), [ORT_MJS]: nm(`onnxruntime-web/dist/${ORT_MJS}`) };
const TYPES = { '.json': 'application/json; charset=utf-8', '.onnx': 'application/octet-stream', '.wasm': 'application/wasm' };

/**
 * /edge-model/ 底下的檔名 → 本機路徑與型別；不在白名單回 null。
 * @param {string} name 路徑（不含 /edge-model/）
 * @param {{ modelDir?: string }} [o] modelDir：判斷層模型的快取資料夾（JUDGE_MODEL_DIR）
 * @returns {{ file: string, type: string } | null}
 */
export function edgeModelFile(name, { modelDir = nm('.cache/transformers') } = {}) {
  if (name === ORT_WASM) return { file: nm(`onnxruntime-web/dist/${ORT_WASM}`), type: TYPES['.wasm'] };
  const prefix = `${EMBED_MODEL}/`;
  if (!String(name).startsWith(prefix)) return null;
  const rel = name.slice(prefix.length);
  if (!EMBED_FILES.includes(rel)) return null; // 白名單比對整個相對路徑（沒有 ..、沒有其他檔）
  return { file: join(modelDir, EMBED_MODEL, rel), type: TYPES[rel.slice(rel.lastIndexOf('.'))] };
}
