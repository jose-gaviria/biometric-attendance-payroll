"""Compare domain data without exposing names, credentials or embeddings."""
import hashlib
import json
from pathlib import Path
import sqlite3

TABLES = {
    'turnos': ('attendance-payroll.sqlite', ['employees', 'shifts', 'legal_rules', 'payroll_runs', 'payroll_entries', 'face_links']),
    'face': ('face-lab.sqlite', ['face_profiles', 'face_templates', 'admins', 'settings']),
}


def fingerprint(root=Path('/data')):
    result = {}
    for domain, (filename, tables) in TABLES.items():
        path = root / domain / filename
        if not path.is_file():
            raise RuntimeError('Base ausente: ' + domain)
        with sqlite3.connect(path.as_uri() + '?mode=ro', uri=True) as db:
            if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise RuntimeError('Integridad incorrecta: ' + domain)
            if db.execute('PRAGMA foreign_key_check').fetchall():
                raise RuntimeError('Referencias invalidas: ' + domain)
            result[domain] = {}
            for table in tables:
                rows = db.execute('SELECT * FROM ' + table + ' ORDER BY rowid').fetchall()
                digest = hashlib.sha256(json.dumps(rows, default=lambda value: value.hex(), ensure_ascii=True).encode()).hexdigest()
                result[domain][table] = {'count': len(rows), 'digest': digest}
    return result


if __name__ == '__main__':
    print(json.dumps(fingerprint()))
