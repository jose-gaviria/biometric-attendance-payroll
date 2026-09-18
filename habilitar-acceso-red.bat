@echo off
cd /d "%~dp0"
echo Esto abre Administracion (puerto 8080) a otras PC de esta red local.
echo La camara del kiosco sigue exigiendo este equipo; eso no cambia.
echo Windows pedira permiso de administrador: hace falta para el firewall.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -NoExit -File \"%~dp0scripts\habilitar-acceso-red.ps1\"'"
