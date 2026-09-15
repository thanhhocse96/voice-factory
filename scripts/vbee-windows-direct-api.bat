@echo off
setlocal
cd /d "%~dp0.."

where node >nul 2>&1
if errorlevel 1 (
  echo Windows Node is not on PATH.
  echo Install Node 24 for Windows, then run this .bat from cmd.exe or PowerShell.
  echo Do not run it through WSL: Brave CDP is http://127.0.0.1:9222 on Windows, not in the Linux VM.
  exit /b 1
)

echo.
echo VoiceFactory Windows Vbee live probe
echo Production worker remains the Linux Gateway adapter.
echo Project: %CD%
node -e "console.log('Node: ' + process.platform + ' ' + process.version)"
if errorlevel 1 exit /b 1
echo CDP default: http://127.0.0.1:9222
echo Today's Brave must be running with --remote-debugging-port=9222 and studio.vbee.vn logged in.
echo.

if "%~1"=="" (
  node scripts\vbee-windows-direct-api.mjs --probe
) else (
  node scripts\vbee-windows-direct-api.mjs %*
)

endlocal
exit /b %ERRORLEVEL%
