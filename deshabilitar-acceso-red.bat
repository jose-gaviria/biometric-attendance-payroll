@echo off
cd /d "%~dp0"
echo Windows pedira permiso de administrador: hace falta para el firewall.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -NoExit -File \"%~dp0scripts\deshabilitar-acceso-red.ps1\"'"
