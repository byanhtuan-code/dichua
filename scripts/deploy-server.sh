#!/usr/bin/env bash
# Build the amd64 image here, stream it to your server over SSH, restart the container; back to the previous image if it fails.
# Config lives in deploy/deploy.env (see deploy/deploy.env.example). Usage: bash scripts/deploy-server.sh [--yes]
set -euo pipefail
cd "$(dirname "$0")/.."

CONFIG=deploy/deploy.env
if [ ! -f "$CONFIG" ]; then
  echo "Missing $CONFIG. Create it: cp deploy/deploy.env.example $CONFIG, then fill it in."
  exit 1
fi
set -a
# shellcheck disable=SC1090
. "$CONFIG"
set +a

missing=()
for v in DEPLOY_HOST REMOTE_DIR ALLOWED_ORIGINS CADDY_NETWORK; do
  [ -n "${!v:-}" ] || missing+=("$v")
done
if [ "${#missing[@]}" -gt 0 ]; then
  echo "Not enough config in $CONFIG. Fill in: ${missing[*]}"
  echo "See deploy/deploy.env.example for what each one means."
  exit 1
fi
command -v docker >/dev/null || { echo "docker is not installed on this machine."; exit 1; }
[ -n "${ADMIN_PASSWORD:-}" ] || echo "NOTE: ADMIN_PASSWORD is empty, so /admin will be off (404)."

HOST=$DEPLOY_HOST
IMAGE=santinh-rt

# Only committed code ships, and the image tag says which commit is running.
if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree not clean: commit or stash first."
  git status --short
  exit 1
fi
sha=$(git rev-parse --short HEAD)

echo "This builds $IMAGE:$sha and deploys it to $HOST ($REMOTE_DIR)."
if [ "${1:-}" != "--yes" ]; then
  read -r -p "Continue? [y/N] " answer
  [ "$answer" = "y" ] || [ "$answer" = "Y" ] || { echo "aborted"; exit 1; }
fi

ssh "$HOST" "docker compose version >/dev/null" || { echo "Docker with the compose plugin is required on $HOST."; exit 1; }

docker buildx build --platform linux/amd64 -f server/Dockerfile -t "$IMAGE:$sha" -t "$IMAGE:latest" --load .

# What runs now becomes :previous before :latest moves (the rollback target).
ssh "$HOST" "docker image inspect $IMAGE:latest >/dev/null 2>&1 && docker tag $IMAGE:latest $IMAGE:previous || true"
docker save "$IMAGE:$sha" "$IMAGE:latest" | gzip | ssh "$HOST" 'gunzip | docker load'

ssh "$HOST" "mkdir -p $REMOTE_DIR && if [ -f $REMOTE_DIR/docker-compose.yml ]; then cp $REMOTE_DIR/docker-compose.yml $REMOTE_DIR/docker-compose.yml.bak; fi"
scp deploy/compose.yml "$HOST:$REMOTE_DIR/docker-compose.yml"
# A silent copy is not proof: compare content, not just line counts.
local_sum=$(shasum -a 256 deploy/compose.yml | cut -d' ' -f1)
remote_sum=$(ssh "$HOST" "sha256sum $REMOTE_DIR/docker-compose.yml" | cut -d' ' -f1)
[ "$local_sum" = "$remote_sum" ] || { echo "compose.yml copy mismatch (local $local_sum, remote $remote_sum)"; exit 1; }

# compose reads these from $REMOTE_DIR/.env; written from the local config on every deploy.
env_tmp=$(mktemp)
trap 'rm -f "$env_tmp"' EXIT
chmod 600 "$env_tmp"
{
  echo "ALLOWED_ORIGINS=$ALLOWED_ORIGINS"
  echo "ADMIN_PASSWORD=${ADMIN_PASSWORD:-}"
  echo "CADDY_NETWORK=$CADDY_NETWORK"
} > "$env_tmp"
scp "$env_tmp" "$HOST:$REMOTE_DIR/.env"
ssh "$HOST" "chmod 600 $REMOTE_DIR/.env"

if ! ssh "$HOST" "cd $REMOTE_DIR && docker compose up -d --wait"; then
  echo "santinh-rt did not come up healthy: rolling back to $IMAGE:previous + the old compose."
  ssh "$HOST" "cd $REMOTE_DIR && docker compose logs --tail 40 santinh-rt; \
    docker image inspect $IMAGE:previous >/dev/null && docker tag $IMAGE:previous $IMAGE:latest && \
    { [ ! -f docker-compose.yml.bak ] || cp docker-compose.yml.bak docker-compose.yml; } && docker compose up -d --wait"
  exit 1
fi
ssh "$HOST" "cd $REMOTE_DIR && docker compose logs --tail 20 santinh-rt"

# Only our own old images: keep latest / previous / this commit. Never prune the whole server.
ssh "$HOST" "docker images $IMAGE --format '{{.Repository}}:{{.Tag}}' | grep -vE ':(latest|previous|$sha)\$' | xargs -r docker rmi; \
  docker image prune -f --filter label=app=santinh-rt"
echo "deployed $IMAGE:$sha"
echo "Next: point your reverse proxy at santinh-rt:3663 (see deploy/Caddyfile.example) and host the client on a site listed in ALLOWED_ORIGINS."
