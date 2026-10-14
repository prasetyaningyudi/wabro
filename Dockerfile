# Build stage — compile native deps (better-sqlite3)
FROM node:20-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

# Runtime stage
FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3200
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/src ./src
COPY --from=build /app/views ./views
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 3200
VOLUME ["/app/data"]
CMD ["node", "src/server.js"]
