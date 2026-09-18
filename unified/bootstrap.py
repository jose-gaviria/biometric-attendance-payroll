"""Prepara un volumen vacio para una instalacion nueva, sin datos de nadie.

Crea el secreto de sesion, el canal interno y las dos bases vacias. No define
ninguna clave de administracion: la escribe el usuario la primera vez que entra
al panel, y queda cifrada dentro de la base.

Se niega a tocar un volumen que ya tenga algo dentro.
"""
import json
import os
from pathlib import Path
import secrets
import sqlite3
import subprocess

ROOT = Path('/data')


def main():
    if any(ROOT.iterdir()):
        raise RuntimeError('El volumen ya tiene datos; no se inicializa encima')
    os.umask(0o077)
    (ROOT / 'config').mkdir()
    (ROOT / 'turnos').mkdir()
    (ROOT / 'face').mkdir()
    (ROOT / 'backups').mkdir()

    (ROOT / 'config' / 'turnos.json').write_text(json.dumps({
        'SESSION_SECRET': secrets.token_hex(32),
    }), encoding='utf-8')
    (ROOT / 'config' / 'laboratory.json').write_text('{}', encoding='utf-8')
    (ROOT / 'config' / 'bridge.key').write_text(secrets.token_hex(32), encoding='utf-8')

    # Cada aplicacion crea su propio esquema al abrir su base por primera vez.
    subprocess.run(
        ['node-turnos', '-e',
         "import('/opt/turnos/dist-server/db.js').then(({db})=>db.close())"],
        env={**os.environ, 'DATA_DIR': '/data/turnos'}, check=True)
    subprocess.run(
        ['node', '-e',
         "import('/opt/face-lab/dist/server/server/db.js')"
         ".then(({openDatabase})=>openDatabase('/data/face/face-lab.sqlite').close())"],
        check=True)

    for nombre, archivo in (('turnos', 'attendance-payroll.sqlite'), ('face', 'face-lab.sqlite')):
        base = ROOT / nombre / archivo
        if not base.is_file():
            raise RuntimeError('No se creo la base: ' + nombre)
        with sqlite3.connect(base, timeout=10) as conexion:
            if conexion.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                raise RuntimeError('Base inicializada con errores: ' + nombre)

    for ruta in (ROOT, *ROOT.rglob('*')):
        os.chmod(ruta, 0o700 if ruta.is_dir() else 0o600)
    print('INSTALACION_INICIALIZADA', flush=True)


if __name__ == '__main__':
    main()
