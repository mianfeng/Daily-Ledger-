FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/data
ENV BACKUP_DIR=/backups

COPY --from=build /app/server ./server
COPY --from=build /app/dist ./dist

EXPOSE 3000

CMD ["node", "server/index.mjs"]
