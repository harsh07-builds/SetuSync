# Build context is the repository root:
#   docker build -f apps/demo/Dockerfile .

# ---- build -------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.json ./
COPY packages ./packages
COPY apps/demo ./apps/demo
COPY apps/benchmark ./apps/benchmark
# `npm install` (not `npm ci`) so the build also works right after new
# dependencies (qrcode, jsqr) were added and package-lock.json has not been
# refreshed yet. Run `npm install` once locally and commit the lockfile to
# switch this back to `npm ci` for fully reproducible builds.
# --ignore-scripts: skips the native onnxruntime-node download (only the browser runtime is used).
RUN npm install --no-audit --no-fund --ignore-scripts
RUN npm run build:protocol && npm run build -w @setusync/demo

# ---- serve -------------------------------------------------------------
FROM nginx:1.27-alpine
# Where nginx forwards /v1/* (the Relay). Override for another host.
ENV RELAY_UPSTREAM=http://relay:8080
# Leave empty to use the same origin (recommended). Set to a full URL
# only if the browser should talk to a Relay on another domain.
ENV RELAY_URL=
COPY --from=build /repo/apps/demo/dist /usr/share/nginx/html
COPY apps/demo/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY apps/demo/40-setusync-config.sh /docker-entrypoint.d/40-setusync-config.sh
RUN chmod +x /docker-entrypoint.d/40-setusync-config.sh
EXPOSE 80
