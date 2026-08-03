FROM node:20-alpine

WORKDIR /app

# Copy dependency manifests
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production

# Copy server application code
COPY . .

# Expose HTTP & WebSocket port
EXPOSE 4000

ENV NODE_ENV=production
ENV PORT=4000

CMD ["node", "server.js"]
