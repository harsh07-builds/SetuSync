#!/bin/sh
# Writes the runtime config the app loads before it starts.
set -eu
URL=$(printf '%s' "${RELAY_URL:-}" | sed 's/[\\"]//g')
printf 'window.__SETUSYNC_CONFIG__ = { relayUrl: "%s" };\n' "$URL" \
  > /usr/share/nginx/html/config.js
