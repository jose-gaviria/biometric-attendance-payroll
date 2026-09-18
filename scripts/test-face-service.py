"""Prueba el motor incluido en la imagen unificada, sin tocar datos persistentes."""
import base64
import json
from pathlib import Path
import subprocess

FIXTURE_PATHS={
    'a':Path('tests/fixtures/astronaut.png'),
    'b':Path('tests/fixtures/grace_hopper.jpg'),
}
fixtures={key:base64.b64encode(path.read_bytes()).decode() for key,path in FIXTURE_PATHS.items()}
test_code=Path('face-service/tests/test_engine.py').read_bytes()
wrapper="""
import base64,subprocess,time,urllib.request
server=subprocess.Popen(['python','-m','uvicorn','main:app','--host','127.0.0.1','--port','5001','--no-access-log'])
try:
    for _ in range(60):
        try:
            urllib.request.urlopen('http://127.0.0.1:5001/health',timeout=1).close();break
        except Exception: time.sleep(.2)
    else: raise RuntimeError('El motor no inicio')
    globals()['__file__']='/service/tests/test_engine.py'
    exec(compile(base64.b64decode(%r),'<test_engine.py>','exec'),globals())
finally:
    server.terminate()
    try: server.wait(timeout=5)
    except subprocess.TimeoutExpired: server.kill()
""" % base64.b64encode(test_code).decode()
result=subprocess.run([
    'docker','run','--rm','-i','--network','none','-w','/service','--entrypoint','python',
    'biometric-attendance-payroll:1.0.0','-c',wrapper
],input=json.dumps(fixtures),text=True)
raise SystemExit(result.returncode)
