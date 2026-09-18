@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-offline.ps1
if errorlevel 1 (
  echo La operacion no se completo. Revisa el mensaje anterior.
  pause
  exit /b 1
)
pause
