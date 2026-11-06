FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS pruned
ARG PACKAGE
COPY . .
RUN pnpm dlx turbo@2.10.12 prune ${PACKAGE} --docker

FROM base AS build
ARG PACKAGE
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY --from=pruned /repo/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruned /repo/out/full/ .
RUN pnpm turbo run build --filter=${PACKAGE}
RUN pnpm --filter=${PACKAGE} deploy --legacy --prod /app

FROM node:24-slim AS web
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3001
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
EXPOSE 3001
CMD ["node", "apps/web/server.js"]

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app .
CMD ["node", "dist/server.js"]
