FROM node:20-slim

# wget is used by docker-compose healthcheck
RUN apt-get update && apt-get install -y wget && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

ENV PORT=3001

EXPOSE 3001

CMD ["node", "server.js"]
