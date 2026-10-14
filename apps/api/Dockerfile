FROM node:24-slim
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
ENV NODE_ENV=production
EXPOSE 3001
# Migrations are idempotent; run them before starting the api.
CMD ["sh", "-c", "pnpm attn migrate && pnpm --filter @attn/api start"]
