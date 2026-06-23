#!/usr/bin/env bash
# Lance le serveur local de dev avec headers no-cache, et ouvre le
# navigateur sur la bonne URL. Tue d'abord tout ancien serveur qui
# squatterait le port pour éviter les "port already in use" silencieux
# qui font qu'on croit avoir redémarré sans avoir redémarré.

cd "$(dirname "$0")"
PORT=8888
URL="http://127.0.0.1:${PORT}/"

# Tue tout processus qui écoute déjà sur ce port.
if lsof -ti :"${PORT}" >/dev/null 2>&1; then
  echo "→ Un serveur écoute déjà sur ${PORT}, on le tue."
  lsof -ti :"${PORT}" | xargs kill -9 2>/dev/null || true
  sleep 0.3
fi

# `?_=$(date +%s)` casse aussi le cache page-level au cas où.
( sleep 0.8 && open "${URL}?_=$(date +%s)" ) &

exec python3 serve.py "${PORT}"
