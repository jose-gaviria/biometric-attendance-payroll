"""Import a private migration tar from stdin into a fresh Docker volume."""
import os
from pathlib import Path
import sys
import tarfile

root = Path('/data')
if any(root.iterdir()):
    raise RuntimeError('El volumen ya tiene datos; importacion rechazada')
os.umask(0o077)
with tarfile.open(fileobj=sys.stdin.buffer, mode='r|') as archive:
    for entry in archive:
        target = (root / entry.name).resolve()
        if not target.is_relative_to(root) or not entry.isfile():
            raise RuntimeError('Entrada de archivo no admitida')
        target.parent.mkdir(parents=True, exist_ok=True)
        with archive.extractfile(entry) as source, target.open('xb') as destination:
            while block := source.read(1024 * 1024):
                destination.write(block)
print('Datos importados al volumen Docker.', flush=True)
