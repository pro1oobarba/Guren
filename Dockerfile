FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

# .env не копируется (в .gitignore/.dockerignore) — все секреты приходят
# через переменные окружения платформы (Northflank env vars).
ENV PORT=8787
EXPOSE 8787

CMD ["node", "server.js"]
