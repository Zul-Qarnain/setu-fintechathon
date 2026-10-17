# Setu web — Next.js standalone image. Serves on port 3000.
# Build:  docker build -t setu-web --build-arg NEXT_PUBLIC_API_URL=http://localhost:8000 .
# Note: NEXT_PUBLIC_* values are inlined at build time (browser talks to the API directly).
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /app
ARG NEXT_PUBLIC_API_URL=http://localhost:8000
ARG NEXT_PUBLIC_MOCK=false
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_PUBLIC_MOCK=$NEXT_PUBLIC_MOCK NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S setu && adduser -S setu -G setu
COPY --from=build --chown=setu:setu /app/.next/standalone ./
COPY --from=build --chown=setu:setu /app/.next/static ./.next/static
COPY --from=build --chown=setu:setu /app/public ./public
USER setu
EXPOSE 3000
CMD ["node", "server.js"]
