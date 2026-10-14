FROM node:24-slim
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
# The /api/* rewrite is baked in at build time.
ARG API_URL=http://api:3001
ENV API_URL=$API_URL
RUN pnpm --filter @attn/web build
ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "--filter", "@attn/web", "start"]
