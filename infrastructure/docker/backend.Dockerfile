# Mizan backend - production image
FROM node:20-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY libs/shared/package.json libs/shared/
COPY apps/backend/package.json apps/backend/
RUN npm ci --workspaces --include-workspace-root
COPY tsconfig.base.json ./
COPY libs/shared libs/shared
COPY apps/backend apps/backend
RUN npm run build -w @mizan/shared && npm run build -w @mizan/backend \
  && npm prune --omit=dev --workspaces --include-workspace-root

FROM node:20-alpine AS runtime
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/libs/shared/dist ./libs/shared/dist
COPY --from=build /repo/libs/shared/package.json ./libs/shared/
COPY --from=build /repo/apps/backend/dist ./apps/backend/dist
COPY --from=build /repo/apps/backend/package.json ./apps/backend/
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health/ready || exit 1
CMD ["node", "apps/backend/dist/main.js"]
