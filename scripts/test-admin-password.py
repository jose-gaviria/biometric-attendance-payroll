"""Ciclo completo de la clave de administracion en una instalacion desechable.

Comprueba lo que pidio el usuario: la instalacion llega sin clave, la define
quien entra por primera vez, esa es la que sirve siempre, y para cambiarla hay
que escribir la actual. Comprueba ademas lo que no se ve: que nadie pueda
redefinirla por la puerta de estreno una vez existe, que una clave equivocada no
abra nada, y que al cambiarla caduquen las sesiones ya abiertas.

Nunca toca el volumen del usuario: exige un volumen propio y vacio, y lo retira
al final.
"""
import json
from pathlib import Path
import subprocess
import time

IMAGE = 'biometric-attendance-payroll:1.0.0'
CONTAINER = 'verify-password'
VOLUME = 'verify-password-data'
ROOT = Path(__file__).resolve().parent.parent
PRIMERA = 'Clave-Inicial-2026'
SEGUNDA = 'Clave-Cambiada-2026'


def command(args, **kwargs):
    result = subprocess.run(args, capture_output=True, **kwargs)
    if result.returncode:
        detalle = result.stderr.decode(errors='replace') if isinstance(result.stderr, bytes) else result.stderr
        print(detalle, flush=True)
        raise RuntimeError('Fallo de comprobacion: ' + args[0] + ' (codigo ' + str(result.returncode) + ')')
    return result


def ready():
    for _ in range(45):
        if subprocess.run(['docker', 'exec', CONTAINER, 'python', '/opt/unified/health.py'],
                          capture_output=True).returncode == 0:
            return
        time.sleep(2)
    raise RuntimeError('El contenedor de prueba no alcanzo la salud')


GUION = """
import json, urllib.request, urllib.error, http.cookiejar

def cliente():
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    def call(path, data=None):
        peticion = urllib.request.Request('http://127.0.0.1:3001' + path,
            data=json.dumps(data).encode() if data is not None else None,
            headers={'Content-Type': 'application/json', 'Origin': 'http://localhost:8080'})
        try:
            with opener.open(peticion, timeout=20) as respuesta:
                return respuesta.status, json.load(respuesta)
        except urllib.error.HTTPError as error:
            return error.code, json.load(error)
    return call

PRIMERA = '__PRIMERA__'
SEGUNDA = '__SEGUNDA__'
resultado = {}

# --- Recien instalado: no hay clave y el panel lo declara ---
navegador = cliente()
resultado['sesion_inicial'] = navegador('/api/admin/session')[1]
resultado['entrar_sin_clave_definida'] = navegador('/api/admin/login', {'password': PRIMERA})[0]
resultado['panel_cerrado_antes'] = navegador('/api/admin/employees')[0]

# --- Primera entrada: se define la clave y queda dentro ---
resultado['clave_corta'] = navegador('/api/admin/password/setup',
                                     {'password': 'corta', 'confirm': 'corta'})[0]
resultado['no_coinciden'] = navegador('/api/admin/password/setup',
                                      {'password': PRIMERA, 'confirm': PRIMERA + 'x'})[0]
resultado['definir'] = navegador('/api/admin/password/setup',
                                 {'password': PRIMERA, 'confirm': PRIMERA})[0]
resultado['sesion_tras_definir'] = navegador('/api/admin/session')[1]
resultado['panel_abierto_al_definir'] = navegador('/api/admin/employees')[0]

# --- Ya definida: nadie la redefine por la puerta de estreno ---
intruso = cliente()
resultado['estreno_cerrado'] = intruso('/api/admin/password/setup',
                                       {'password': 'Otra-Clave-Intrusa', 'confirm': 'Otra-Clave-Intrusa'})[0]
resultado['intruso_sigue_fuera'] = intruso('/api/admin/employees')[0]

# --- Esa clave es la que sirve siempre ---
otro = cliente()
resultado['clave_equivocada'] = otro('/api/admin/login', {'password': 'no-es-esta-clave'})[0]
resultado['clave_correcta'] = otro('/api/admin/login', {'password': PRIMERA})[0]
resultado['panel_tras_entrar'] = otro('/api/admin/employees')[0]

# --- Cambiarla exige la actual ---
resultado['cambio_sin_actual'] = otro('/api/admin/password',
    {'current': 'equivocada', 'password': SEGUNDA, 'confirm': SEGUNDA})[0]
resultado['cambio_nuevas_distintas'] = otro('/api/admin/password',
    {'current': PRIMERA, 'password': SEGUNDA, 'confirm': SEGUNDA + 'x'})[0]
resultado['cambio_repetida'] = otro('/api/admin/password',
    {'current': PRIMERA, 'password': PRIMERA, 'confirm': PRIMERA})[0]
resultado['cambio_correcto'] = otro('/api/admin/password',
    {'current': PRIMERA, 'password': SEGUNDA, 'confirm': SEGUNDA})[0]

# --- La vieja deja de valer y la nueva entra ---
final = cliente()
resultado['vieja_ya_no_sirve'] = final('/api/admin/login', {'password': PRIMERA})[0]
resultado['nueva_sirve'] = final('/api/admin/login', {'password': SEGUNDA})[0]

# La sesion que hizo el cambio sigue abierta; la que estaba abierta aparte, no.
resultado['quien_cambio_sigue_dentro'] = otro('/api/admin/employees')[0]
resultado['sesion_vieja_caducada'] = navegador('/api/admin/employees')[0]

# Cinco fallos consecutivos activan el bloqueo temporal; el intento siguiente
# recibe 429 en vez de seguir calculando bcrypt indefinidamente.
atacante = cliente()
resultado['intentos_ataque'] = [
    atacante('/api/admin/login', {'password': 'incorrecta-' + str(i)})[0]
    for i in range(5)
]
resultado['ataque_bloqueado'] = atacante(
    '/api/admin/login', {'password': SEGUNDA}
)[0]

print(json.dumps(resultado))
""".replace('__PRIMERA__', PRIMERA).replace('__SEGUNDA__', SEGUNDA)


if __name__ == '__main__':
    for nombre, args in ((CONTAINER, ['docker', 'container', 'inspect', CONTAINER]),
                         (VOLUME, ['docker', 'volume', 'inspect', VOLUME])):
        if subprocess.run(args, capture_output=True).returncode == 0:
            raise RuntimeError('Ya existe ' + nombre + '; revisalo antes de repetir la prueba')
    command(['docker', 'volume', 'create', VOLUME])
    # Se inicializa igual que en el equipo de destino: sin clave ninguna.
    command(['docker', 'run', '--rm', '--network', 'none', '-v', VOLUME + ':/data',
             '--entrypoint', 'python', IMAGE, '/opt/unified/bootstrap.py'])
    command(['docker', 'run', '-d', '--name', CONTAINER, '--network', 'none', '--read-only',
             '--tmpfs', '/tmp', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
             '--stop-timeout', '45', '-v', VOLUME + ':/data', IMAGE])
    try:
        ready()
        r = json.loads(command(['docker', 'exec', '-i', CONTAINER, 'python', '-'],
                               input=GUION.encode('utf-8'), text=False).stdout)
        # Llega sin clave y sin panel.
        assert r['sesion_inicial'] == {'authenticated': False, 'configured': False}, r
        assert r['entrar_sin_clave_definida'] == 409, r
        assert r['panel_cerrado_antes'] == 401, r
        # La define quien entra primero, con sus reglas.
        assert r['clave_corta'] == 400, r
        assert r['no_coinciden'] == 400, r
        assert r['definir'] == 201, r
        assert r['sesion_tras_definir'] == {'authenticated': True, 'configured': True}, r
        assert r['panel_abierto_al_definir'] == 200, r
        # Y ya no se puede redefinir sin conocerla.
        assert r['estreno_cerrado'] == 409, r
        assert r['intruso_sigue_fuera'] == 401, r
        # Es la que sirve siempre.
        assert r['clave_equivocada'] == 401, r
        assert r['clave_correcta'] == 200, r
        assert r['panel_tras_entrar'] == 200, r
        # Cambiarla exige la actual.
        assert r['cambio_sin_actual'] == 401, r
        assert r['cambio_nuevas_distintas'] == 400, r
        assert r['cambio_repetida'] == 400, r
        assert r['cambio_correcto'] == 200, r
        # Despues manda la nueva.
        assert r['vieja_ya_no_sirve'] == 401, r
        assert r['nueva_sirve'] == 200, r
        assert r['quien_cambio_sigue_dentro'] == 200, r
        assert r['sesion_vieja_caducada'] == 401, r
        assert r['intentos_ataque'] == [401, 401, 401, 401, 401], r
        assert r['ataque_bloqueado'] == 429, r
        print('CLAVE_ADMIN_OK ' + json.dumps(r), flush=True)
    finally:
        subprocess.run(['docker', 'rm', '-f', CONTAINER], capture_output=True)
        subprocess.run(['docker', 'volume', 'rm', VOLUME], capture_output=True)
        print('Instalacion desechable retirada.', flush=True)
