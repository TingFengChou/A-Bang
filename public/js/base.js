// API 位址（ADR-0013）：網頁版是空字串（同站）；手機 App 打包時由 scripts/build-app.js 注入 window.__ABANG_API_BASE__。
export const API_BASE = String(globalThis.__ABANG_API_BASE__ || '').replace(/\/+$/, '');
/** 是否在手機 App 裡（Capacitor） */
export const IN_APP = Boolean(globalThis.__ABANG_APP__);
