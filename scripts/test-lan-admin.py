"""Comprueba que la LAN exponga Administración, pero no la marcación."""
import http.cookiejar
import json
from pathlib import Path
import subprocess
import time

IMAGE = 'biometric-attendance-payroll:1.0.0'
CONTAINER = 'verify-lan'
VOLUME = 'verify-lan-data'
ROOT = Path(__file__).resolve().parent.parent


def command(args, **kwargs):
    result = subprocess.run(args, capture_output=True, **kwargs)
    if result.returncode:
        detail = result.stderr.decode(errors='replace') if isinstance(result.stderr, bytes) else result.stderr
        raise RuntimeError(detail or 'Fallo: ' + ' '.join(args))
    return result


def ready():
    for _ in range(45):
        if subprocess.run(['docker', 'exec', CONTAINER, 'python', '/opt/unified/health.py'],
                          capture_output=True).returncode == 0:
            return
        time.sleep(2)
    raise RuntimeError('El contenedor LAN de prueba no alcanzo la salud')


CLIENT = r"""
import http.cookiejar,json,urllib.request,urllib.error
jar=http.cookiejar.CookieJar()
opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
def call(path, method='GET', body=None, host='192.168.50.20:8080'):
    request=urllib.request.Request('http://127.0.0.1:3001'+path,
        data=json.dumps(body).encode() if body is not None else None,method=method,
        headers={'Host':host,'Origin':'http://'+host,'Content-Type':'application/json'})
    try:
        with opener.open(request,timeout=15) as response:
            return response.status,json.load(response)
    except urllib.error.HTTPError as error:
        return error.code,json.load(error)

assert call('/api/admin/session')[0] == 200
assert call('/api/kiosk/employees')[0] == 403
assert call('/api/face/attempts','POST',{'action':'in'})[0] == 403
assert call('/api/admin/login','POST',{'password':'Test-unified-4826'})[0] == 200
assert call('/api/admin/employees')[0] == 200
assert call('/api/face/profiles')[0] == 200
assert call('/api/admin/session',host='192.168.50.99:8080')[0] == 403
assert call('/api/kiosk/employees',host='127.0.0.1:3001')[0] == 200
print(json.dumps({'administracion_lan':True,'rostros_admin_lan':True,
                  'kiosco_lan_bloqueado':True,'host_ajeno_bloqueado':True,
                  'kiosco_local':True}))
"""


if __name__ == '__main__':
    for name, args in ((CONTAINER, ['docker', 'container', 'inspect', CONTAINER]),
                       (VOLUME, ['docker', 'volume', 'inspect', VOLUME])):
        if subprocess.run(args, capture_output=True).returncode == 0:
            raise RuntimeError('Ya existe ' + name + '; revisalo antes de repetir')
    command(['docker', 'volume', 'create', VOLUME])
    command(['docker', 'run', '--rm', '--network', 'none', '-v', VOLUME + ':/data',
             '--entrypoint', 'python', IMAGE, '-c',
             (ROOT / 'unified/test_seed.py').read_text(encoding='utf-8')])
    command(['docker', 'run', '-d', '--name', CONTAINER, '--network', 'none',
             '--read-only', '--tmpfs', '/tmp', '--cap-drop', 'ALL',
             '--security-opt', 'no-new-privileges:true', '-e',
             'LAN_ORIGIN=http://192.168.50.20:8080', '-v', VOLUME + ':/data', IMAGE])
    try:
        ready()
        result = command(['docker', 'exec', '-i', CONTAINER, 'python', '-'],
                         input=CLIENT, text=True)
        print('LAN_SOLO_ADMIN_OK ' + result.stdout.strip(), flush=True)
    finally:
        subprocess.run(['docker', 'rm', '-f', CONTAINER], capture_output=True)
        subprocess.run(['docker', 'volume', 'rm', VOLUME], capture_output=True)
        print('Instalacion desechable retirada.', flush=True)
