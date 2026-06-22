@echo off
cd /d "%~dp0"
set PORT=8888
echo Spotify Stats sur http://127.0.0.1:%PORT%/
start "" "http://127.0.0.1:%PORT%/"
python -m http.server %PORT% --bind 127.0.0.1
