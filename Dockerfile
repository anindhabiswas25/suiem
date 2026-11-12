# Suiem API (NestJS + Fastify) with the research worker, reputation jobs and elections
# indexer running in-process. Used by Railway; works with any container host.
FROM node:24-slim
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@11.17.0 --activate
WORKDIR /app

COPY . .
RUN pnpm install --frozen-lockfile

ENV NODE_ENV=production API_PORT=4000
EXPOSE 4000
CMD ["pnpm", "--filter", "@suiem/api", "start"]
