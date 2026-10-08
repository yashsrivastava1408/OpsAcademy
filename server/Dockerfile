FROM node:26-alpine

WORKDIR /app

# Build tools for compiling node-pty, plus the basic tools labs expect when
# sandboxes run as PTY shells inside this container (SANDBOX_MODE=pty).
RUN apk add --no-cache python3 make g++ bash git curl procps

# Copy dependency manifests
COPY package*.json ./

# Install production dependencies
RUN npm ci --omit=dev

# Copy server application code
COPY . .

# Expose HTTP & WebSocket port
EXPOSE 4000

ENV NODE_ENV=production
ENV PORT=4000
# Mount a volume here to keep accounts, progress and certificates across restarts.
ENV DATA_DIR=/data

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:${PORT}/api/health >/dev/null || exit 1

CMD ["node", "server.js"]
