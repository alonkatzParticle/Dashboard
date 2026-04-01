FROM node:20-slim

# Install build tools needed for better-sqlite3 native compilation
RUN apt-get update && apt-get install -y \
  python3 \
  make \
  g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Create a directory for the SQLite database
RUN mkdir -p /data

ENV PORT=3001
ENV DB_PATH=/data/slack_summary.db

EXPOSE 3001

CMD ["node", "server.js"]
