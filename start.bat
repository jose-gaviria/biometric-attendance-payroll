@echo off
docker start registro-de-entradas
if errorlevel 1 echo No se pudo iniciar registro-de-entradas. Comprueba Docker Desktop.
pause
