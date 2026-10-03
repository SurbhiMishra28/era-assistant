@echo off
rem start-era.cmd - Era auto-restart watchdog (Windows; the systemd equivalent for this box).
rem Restarts server.js 3s after any exit. Logs to gitignored era-server.log.
rem Stop: close this window, or  taskkill /F /IM node.exe   Remove auto-start:
rem   schtasks /Delete /TN "Era Assistant" /F
title Era Assistant (auto-restart)
:loop
cd /d "%~dp0"
node server.js >> era-server.log 2>&1
echo [%date% %time%] Era exited (code %errorlevel%) - restarting in 3s >> era-server.log
timeout /t 3 /nobreak >nul
goto loop
