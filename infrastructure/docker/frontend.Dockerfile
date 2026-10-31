# Mizan frontend - static build served by nginx
FROM node:20-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY libs/shared/package.json libs/shared/
COPY apps/frontend/package.json apps/frontend/
RUN npm ci --workspaces --include-workspace-root
COPY tsconfig.base.json ./
COPY libs/shared libs/shared
COPY apps/frontend apps/frontend
RUN npm run build -w @mizan/shared && npm run build -w @mizan/frontend

FROM nginx:1.27-alpine
COPY infrastructure/nginx/frontend.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/frontend/dist/frontend/browser /usr/share/nginx/html
EXPOSE 80
