FROM node:20-slim

# Install ffmpeg for media/sticker commands and build tools for native addons (better-sqlite3, sharp)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install production dependencies first for better layer caching
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application source
COPY . .

ENV NODE_ENV=production
EXPOSE 8000

CMD ["node", "index.js"]
