@echo off
docker ps -a --filter "name=^/registro-de-entradas$" --format "{{.Names}}: {{.Status}}"
docker exec registro-de-entradas python /opt/unified/health.py
pause
