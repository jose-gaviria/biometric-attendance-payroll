from pathlib import Path
import subprocess
import sys

# La arquitectura vigente ya no tiene contenedores separados llamados `app` y
# `face-service`. El mismo caso frontal forma parte de la regresión unificada.
test = Path(__file__).with_name('test-unified.py')
raise SystemExit(subprocess.run([sys.executable, str(test)]).returncode)
