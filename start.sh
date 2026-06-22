#!/usr/bin/env bash
cd "$(dirname "$0")"
PORT=8888
URL="http://127.0.0.1:${PORT}/"
echo "→ Spotify Stats sur ${URL}"
( sleep 1 && open "${URL}" ) &
python3 -m http.server "${PORT}" --bind 127.0.0.1
