"""One Docker lifecycle for inference, facial API and attendance API."""
import json
import os
from pathlib import Path
import signal
import sqlite3
import subprocess
import sys
import time

from backup import DATABASES, backup_all
from health import healthy

ROOT = Path('/data')
stopping = False


def stop_requested(_signal, _frame):
    global stopping
    stopping = True


def stop_process(process):
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


def main():
    os.umask(0o077)
    signal.signal(signal.SIGTERM, stop_requested)
    signal.signal(signal.SIGINT, stop_requested)
    # Refuse to silently start with empty databases or replacement credentials.
    private = json.loads((ROOT / 'config' / 'turnos.json').read_text())
    # La clave de administracion ya no vive aqui: la define el usuario al entrar
    # por primera vez y se guarda cifrada en la base.
    if not isinstance(private.get('SESSION_SECRET'), str) or not private['SESSION_SECRET']:
        raise RuntimeError('Configuracion privada incompleta')
    bridge = ROOT / 'config' / 'bridge.key'
    if len(bridge.read_text().strip()) != 64:
        raise RuntimeError('Canal interno no configurado')
    for name, filename in DATABASES.items():
        file = ROOT / name / filename
        if not file.is_file():
            raise RuntimeError('Falta base migrada: ' + name)
        with sqlite3.connect(file, timeout=10) as db:
            if db.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                raise RuntimeError('Integridad de base incorrecta: ' + name)
    # Las instalaciones antiguas guardaban la clave en texto plano aqui. Una vez
    # que la aplicacion la ha pasado a la base, cifrada, se retira del archivo.
    if 'ADMIN_PASSWORD' in private:
        with sqlite3.connect(ROOT / 'turnos' / DATABASES['turnos'], timeout=10) as db:
            migrada = db.execute(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='admin_credential'"
            ).fetchone()[0] and db.execute(
                'SELECT count(*) FROM admin_credential WHERE id=1').fetchone()[0]
        if migrada:
            del private['ADMIN_PASSWORD']
            archivo = ROOT / 'config' / 'turnos.json'
            temporal = archivo.with_suffix('.json.nuevo')
            temporal.write_text(json.dumps(private), encoding='utf-8')
            os.chmod(temporal, 0o600)
            os.replace(temporal, archivo)
            print('Clave de administracion retirada de la configuracion.', flush=True)

    backup_all()
    env = os.environ.copy()
    lab_options = json.loads((ROOT / 'config' / 'laboratory.json').read_text())
    lab_env = {**env, **lab_options, 'PORT': '8081',
               'APP_ORIGIN': env.get('LAB_ORIGIN', 'http://localhost:8091'),
               'DATA_DIR': '/data/face', 'BACKUP_DIR': '/data/backups/face',
               'FACE_SERVICE_URL': 'http://127.0.0.1:5001',
               'TURNOS_BRIDGE_KEY_FILE': str(bridge)}
    turnos_env = {**env, **private, 'PORT': '3001',
                  'APP_ORIGIN': env.get('TURNOS_ORIGIN', 'http://localhost:8080'),
                  'DATA_DIR': '/data/turnos', 'BACKUP_DIR': '/data/backups/turnos',
                  'FACE_LAB_URL': 'http://127.0.0.1:8081',
                  'FACE_LAB_ORIGIN': lab_env['APP_ORIGIN'], 'FACE_BRIDGE_KEY_FILE': str(bridge)}
    specs = [
        ('face-engine', ['python', '-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', '5001',
                         '--workers', '1', '--no-access-log', '--limit-concurrency', '8'], '/service', env),
        ('laboratory', ['node', 'dist/server/server/index.js'], '/opt/face-lab', lab_env),
        ('turnos', ['node-turnos', 'dist-server/index.js'], '/opt/turnos', turnos_env),
    ]
    workers = {}

    def start(spec):
        name, command, cwd, child_env = spec
        workers[name] = {'process': subprocess.Popen(command, cwd=cwd, env=child_env),
                         'started': time.monotonic(), 'failures': 0}
        print('Servicio iniciado: ' + name, flush=True)

    try:
        for spec in specs:
            start(spec)
        last_health, last_backup = time.monotonic(), time.monotonic()
        restarts = []
        while not stopping:
            current = time.monotonic()
            check = current - last_health >= 10
            if check:
                last_health = current
            for spec in specs:
                name = spec[0]
                worker = workers[name]
                process = worker['process']
                crashed = process.poll() is not None
                if check and current - worker['started'] > 60:
                    worker['failures'] = 0 if healthy(name) else worker['failures'] + 1
                if crashed or worker['failures'] >= 3:
                    stop_process(process)
                    restarts = [t for t in restarts if current - t < 300]
                    if len(restarts) >= 6:
                        raise RuntimeError('Fallos repetidos; Docker reiniciara el conjunto')
                    restarts.append(current)
                    print('Recuperando servicio: ' + name, flush=True)
                    start(spec)
            if current - last_backup >= 86400:
                try:
                    backup_all()
                    last_backup = current
                except Exception as error:
                    print('Respaldo pendiente: ' + type(error).__name__, flush=True)
                    last_backup = current - 86400 + 300
            time.sleep(0.5)
    finally:
        for spec in reversed(specs):
            if spec[0] in workers:
                stop_process(workers[spec[0]]['process'])
        for name, filename in DATABASES.items():
            with sqlite3.connect(ROOT / name / filename, timeout=10) as db:
                db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
        print('Servicios detenidos; bases cerradas.', flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Do not print private configuration or database content on failure.
        print('No se pudo mantener el sistema: ' + type(error).__name__, flush=True)
        sys.exit(1)
