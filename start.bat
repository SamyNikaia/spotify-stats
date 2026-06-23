@echo off
REM Lance le serveur local de dev avec headers no-cache et ouvre le
REM navigateur. Le param ?_=%RANDOM% casse aussi le cache page-level.

cd /d "%~dp0"
set PORT=8888
echo Spotify Stats sur http://127.0.0.1:%PORT%/

start "" "http://127.0.0.1:%PORT%/?_=%RANDOM%"
python serve.py %PORT%
