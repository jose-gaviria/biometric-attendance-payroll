"""Synthetic fixture initialization. Never run against the user's data volume."""
import json
from pathlib import Path
import subprocess
import os

root = Path('/data')
if any(root.iterdir()):
    raise RuntimeError('Seed requires an empty test volume')
(root / 'config').mkdir()
(root / 'config/turnos.json').write_text(json.dumps({'ADMIN_PASSWORD': 'Test-unified-4826', 'SESSION_SECRET': 'synthetic-unified-test-only'}))
(root / 'config/laboratory.json').write_text('{}')
(root / 'config/bridge.key').write_text('d' * 64)
subprocess.run(['node-turnos', '-e', "import('/opt/turnos/dist-server/db.js').then(({db})=>db.close())"],
               env={**os.environ, 'DATA_DIR': '/data/turnos'}, check=True)
subprocess.run(['node', '-e', "import('/opt/face-lab/dist/server/server/db.js').then(({openDatabase})=>openDatabase('/data/face/face-lab.sqlite').close())"],check=True)
print('Datos sintéticos inicializados.')
