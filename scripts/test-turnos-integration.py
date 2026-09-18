"""Compatibilidad para el nombre histórico de la prueba de integración.

La arquitectura separada app/face-service fue reemplazada por el contenedor
único. La prueba vigente cubre Turnos, laboratorio y motor juntos, sin red y
en recursos Docker desechables.
"""
from pathlib import Path
import subprocess
import sys


if __name__ == '__main__':
    test = Path(__file__).with_name('test-unified.py')
    raise SystemExit(subprocess.call([sys.executable, str(test)]))
