@echo off
docker exec -it -w /opt/face-lab -e DATA_DIR=/data/face registro-de-entradas node scripts/admin.mjs
pause
