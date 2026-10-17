# Setu TypeScript backend. Build context = repo root:  docker build -f server/Dockerfile .   (never built on the dev box: no Docker there)
FROM node:20-slim AS build
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/ ./
RUN npm run build

FROM node:20-slim
WORKDIR /app/server
ENV NODE_ENV=production SETU_DATA_DIR=/data PORT=8000
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/server/dist ./dist
COPY server/eval ./eval
COPY data/ /data/
EXPOSE 8000
CMD ["node", "dist/main.js"]
