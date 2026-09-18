@echo off
cd /d "%~dp0"
echo Este equipo encendera Turnos solo al iniciar sesion en Windows.
echo Docker Desktop se cerrara y volvera a abrirse durante el proceso.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/enable-autostart.ps1
if errorlevel 1 (
  echo La operacion no se completo. Revisa el mensaje anterior.
  pause
  exit /b 1
)
pause
