@echo off
setlocal
cd /d "%~dp0"
echo Starting local server for Process Systemization webapp...
echo Open: http://localhost:5173
echo Press Ctrl+C to stop.
echo.
start "" http://localhost:5173
node serve.js
endlocal
