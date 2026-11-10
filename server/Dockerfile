# Build context = repo root: docker buildx build -f server/Dockerfile -t santinh-rt:latest .
FROM node:24-alpine
# Lets the deploy script clean up only its own dangling images.
LABEL app=santinh-rt

WORKDIR /app
ENV NODE_ENV=production

# Manifests of every workspace first: `npm ci` checks the lockfile against all of them, and this layer stays cached.
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY shared/package.json shared/
COPY server/package.json server/
RUN npm ci --omit=dev -w server -w shared --ignore-scripts && npm cache clean --force

COPY shared/src shared/src
COPY server/src server/src

# A fresh named volume copies owner + mode from the image path: without this `node` cannot write population.json.
RUN mkdir -p /app/data && chown node:node /app/data

USER node
EXPOSE 3663
# busybox wget, not a second `node` (~45 MB) inside the 192 MB container.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT:-3663}/api/ping" || exit 1
CMD ["node", "server/src/main.ts"]
