#!/usr/bin/env bash
# Installs frontend/node_modules exactly as frontend/package-lock.json pins them,
# with `npm ci`, which never rewrites the lockfile (`npm install` does, so it
# would show up as a change to upstream's file). Skips the install when the
# lockfile and package.json haven't changed since the last one.

set -euo pipefail

root_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${root_dir}/frontend"

stamp_file="node_modules/.studio-install-stamp"
stamp="$(cat package.json package-lock.json | shasum | cut -d' ' -f1) $(node --version)"

if [[ -f "${stamp_file}" && "$(cat "${stamp_file}")" == "${stamp}" ]]; then
  echo "frontend/node_modules matches package-lock.json"
  exit 0
fi

echo "Installing frontend packages from package-lock.json (npm ci)..."
npm ci --ignore-scripts --no-audit --no-fund
echo "${stamp}" > "${stamp_file}"
