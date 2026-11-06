#!/bin/sh
# Clones the current commit into a new folder and runs every root command there.
#   sh scripts/verify-clean.sh
set -eu
repo=$(pwd)
commit=$(git rev-parse HEAD)
root=$(mktemp -d)
log="$repo/results/clean-checkout/latest.txt"
mkdir -p "$(dirname "$log")"
trap 'rm -rf "$root"' EXIT
git clone -q "$repo" "$root/contour-studio"
cd "$root/contour-studio"
{
  echo "commit $commit"
  echo "date $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "node $(node -v), pnpm $(pnpm -v)"
  for step in "install --frozen-lockfile" "check" "test" "build" "test:e2e" "bench:smoke"; do
    start=$(date +%s)
    # shellcheck disable=SC2086
    pnpm $step > "$root/step.log" 2>&1 || { echo "FAILED pnpm $step"; tail -30 "$root/step.log"; exit 1; }
    echo "passed pnpm $step in $(( $(date +%s) - start )) s"
  done
  grep -E "Tests +[0-9]" "$root/step.log" || true
} | tee "$log"
