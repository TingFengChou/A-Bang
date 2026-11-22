# 阿幫（A-Bang）容器映像（M6-01，ARCHITECTURE §8）：單一 Node 程序提供 PWA、REST、/mcp、agent。
# 金鑰一律由部署平台的環境變數注入（TDX_*、CWA_API_KEY、ANTHROPIC_API_KEY…），不進映像。

# ── 建置：裝完整依賴，打包 MCP Apps 卡片（dist/cards.html）──
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY public ./public
COPY scripts/build-cards.js ./scripts/build-cards.js
RUN npm run build:cards

# ── 執行：只裝正式依賴，非 root 執行 ──
FROM node:22-slim
ENV NODE_ENV=production PORT=8787
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY core ./core
COPY server ./server
COPY mcp ./mcp
COPY public ./public
COPY --from=build /app/dist/cards.html ./dist/cards.html
# 判斷層的嵌入模型（core/agent/judge.js）在建置時先下載進映像，容器啟動不必連網；下載失敗時伺服器自動退回規則判斷
ENV JUDGE_MODEL_DIR=/app/models
COPY scripts/fetch-judge-model.js ./scripts/fetch-judge-model.js
RUN node scripts/fetch-judge-model.js || echo "判斷層模型下載失敗，執行時退回規則判斷"
# 檔案屬 root、對執行者唯讀（本機目錄權限可能是 700，COPY 會保留）
RUN chmod -R a+rX,go-w /app
# TDX 靜態資料存檔（站牌、站序、車站；重啟後先讀檔）：唯一可寫的目錄，compose 以 volume 掛載
ENV TDX_CACHE_DIR=/app/.cache/tdx
RUN mkdir -p /app/.cache/tdx && chown -R node:node /app/.cache
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server/http.js"]
