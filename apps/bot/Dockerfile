FROM node:24.17.0-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 py3-pip make g++
COPY package*.json ./
COPY apps/bot/package*.json apps/bot/
COPY packages/domain/package*.json packages/domain/
RUN npm install
COPY tsconfig.base.json package.json ./
COPY packages/domain packages/domain
COPY apps/bot apps/bot
RUN npm run build:domain && npm run build:bot

FROM node:24.17.0-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache ffmpeg python3 py3-pip \
  && python3 -m pip install --no-cache-dir --break-system-packages "yt-dlp[default]"
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/domain ./packages/domain
COPY --from=build /app/apps/bot/package.json ./apps/bot/package.json
COPY --from=build /app/apps/bot/dist ./apps/bot/dist
CMD ["node", "apps/bot/dist/main.js"]
