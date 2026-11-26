#!/usr/bin/env bash
set -euo pipefail

# Try the upstream release first, then the publicly indexed SourceForge
# mirror if GitHub's release CDN is unavailable (repeated HTTP 504).
# Neither source is trusted until the pinned SHA-256 check below passes.
postgrest_archive="$RUNNER_TEMP/postgrest-v16.5.tar.xz"
if ! curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  --retry 3 --retry-all-errors --retry-delay 3 --retry-max-time 90 \
  https://github.com/PostgREST/postgrest/releases/download/v16.5/postgrest-v16.5-linux-static-x86-64.tar.xz \
  -o "$postgrest_archive"; then
  echo "::warning::GitHub release CDN unavailable; fetching the same pinned PostgREST v16.5 asset from the SourceForge mirror"
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
    --retry 3 --retry-all-errors --retry-delay 3 --retry-max-time 90 \
    https://downloads.sourceforge.net/project/postgrest.mirror/v16.5/postgrest-v16.5-linux-static-x86-64.tar.xz \
    -o "$postgrest_archive"
fi
echo "5099e7ada38f9f6846cd87c14c5f158b7c165f1e9959665ad412e61f4dceba95  $RUNNER_TEMP/postgrest-v16.5.tar.xz" | sha256sum --check --strict
mkdir -p "$RUNNER_TEMP/permission-gateway"
tar -xJf "$RUNNER_TEMP/postgrest-v16.5.tar.xz" -C "$RUNNER_TEMP/permission-gateway"
