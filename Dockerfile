# Production Dockerfile for EPUB AI Audiobook Generator
FROM node:22-slim

# Install system dependencies (ffmpeg, ca-certificates, curl)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy application source code
COPY . .

# Build the frontend assets
RUN npm run build

# Prune dev dependencies for production
RUN npm prune --production

# Create data directory for persistent SQLite database, audio, and epubs
RUN mkdir -p /app/data

# Environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/data

# Expose HTTP port
EXPOSE 3000

# Start the unified backend and frontend server
CMD ["node", "server/index.js"]
