"""Online SQLite backups for both databases, entirely inside the Docker volume."""
from datetime import datetime, timezone
from pathlib import Path
import sqlite3

DATABASES = {'turnos': 'attendance-payroll.sqlite', 'face': 'face-lab.sqlite'}


def backup_all(root=Path('/data')):
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    for name, filename in DATABASES.items():
        source = root / name / filename
        if not source.is_file():
            raise RuntimeError('Falta la base de datos: ' + name)
        target_dir = root / 'backups' / name
        target_dir.mkdir(parents=True, exist_ok=True)
        target = target_dir / ('automatic-' + stamp + '.sqlite')
        with sqlite3.connect(source, timeout=10) as live, sqlite3.connect(target) as saved:
            live.backup(saved, pages=100, sleep=0.1)
            if saved.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise RuntimeError('Respaldo invalido: ' + name)
        # Only our automatic backups are rotated; migrated or manual backups are retained.
        for old in sorted(target_dir.glob('automatic-*.sqlite'), reverse=True)[30:]:
            old.unlink()
    print('Respaldos SQLite de Turnos y rostros verificados.', flush=True)


if __name__ == '__main__':
    backup_all()
