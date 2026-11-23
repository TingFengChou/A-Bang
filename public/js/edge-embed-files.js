// 手機上的小模型（E3）要下載的檔案（主執行緒查大小、Worker 下載與檢查快取共用；伺服器白名單在 server/edge-model.js）
import { EMBED_MODEL, EMBED_FILES } from '../../core/judge-classify.js';

export const ORT_MJS = 'ort-wasm-simd-threaded.asyncify.mjs';
export const ORT_WASM = 'ort-wasm-simd-threaded.asyncify.wasm';
/** 完整網址：執行環境 .wasm（第一個）＋模型檔 */
export const embedUrls = (api) => [`${api}/edge-model/${ORT_WASM}`, ...EMBED_FILES.map((f) => `${api}/edge-model/${EMBED_MODEL}/${f}`)];
