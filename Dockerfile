# ---- Backend: Node + Express + Socket.IO + Puppeteer (Chromium) ----
FROM node:20-slim

# System libraries required by Puppeteer's bundled Chromium on Debian bookworm.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates fonts-liberation wget gnupg \
      libasound2 libatk-bridge2.0-0 libatk1.0-0 libatspi2.0-0 libcairo2 \
      libcups2 libdbus-1-3 libdrm2 libexpat1 libgbm1 libglib2.0-0 \
      libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 libx11-6 libxcb1 \
      libxcomposite1 libxdamage1 libxext6 libxfixes3 libxkbcommon0 \
      libxrandr2 xdg-utils \
  && rm -rf /var/lib/apt/lists/*

# Puppeteer downloads Chromium into the node user's cache during install.
ENV PUPPETEER_CACHE_DIR=/home/node/.cache/puppeteer
ENV NODE_ENV=production

WORKDIR /app
RUN chown -R node:node /app
USER node

# Install deps first (better layer caching). Includes Chromium download.
COPY --chown=node:node package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production=false

# App source
COPY --chown=node:node . .

EXPOSE 5000
CMD ["node", "src/server.js"]
