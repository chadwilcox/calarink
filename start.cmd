@echo off
rem Double-click to run Maine Rink Times and open it in your browser.
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies...
  call npm install --silent
)
start "" http://localhost:5178
node server.js
