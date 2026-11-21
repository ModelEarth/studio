#!/usr/bin/env bash
# Runs the ArtCraft webapp's Vite dev server on 4202 behind the crew Worker,
# which serves the combined site on http://localhost:4201. Same settings as
# script/website/unix_frontend_webapp_dev.sh, which instead takes port 4201 and
# runs `npm install` (rewriting frontend/package-lock.json).

set -e

port="${WEBAPP_DEV_PORT:-4202}"
root_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
frontend_path="${root_dir}/frontend"

source "${root_dir}/script/common/frontend_preflight.sh"
frontend_preflight "${frontend_path}"

if lsof -i "tcp:${port}" -sTCP:LISTEN &>/dev/null; then
  lsof -i "tcp:${port}" -sTCP:LISTEN -t | xargs kill
  echo "Stopped the process on port ${port}"
fi

"${root_dir}/automation/frontend-install.sh"
cd "${frontend_path}"

export VITE_ENVIRONMENT_TYPE="production"
export VITE_USE_LOCAL_API="true"

exec ./node_modules/.bin/nx dev @frontend/artcraft-webapp --port "${port}" --strictPort --host 127.0.0.1 "$@"
