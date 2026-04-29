FROM node:20-alpine

WORKDIR /app

# Install deps. We only need tsx + typescript at runtime; everything else is
# devDependencies for the Workers build.
COPY package.json ./
RUN npm install --omit=dev --omit=optional --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src

# Persistent dedup state lives here.
RUN mkdir -p /app/data
VOLUME ["/app/data"]

ENV STATE_FILE=/app/data/state.json
ENV NODE_ENV=production

CMD ["npx", "tsx", "src/node-entry.ts"]
