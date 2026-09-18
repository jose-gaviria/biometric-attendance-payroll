"""Comprobantes de nomina en PDF: generacion real dentro del contenedor.

Crea una quincena con recargos, extras y bonificaciones en una instalacion
desechable, descarga el PDF general y el de un trabajador, y comprueba que son
PDF validos, con la fuente Nunito incrustada y el logo dentro.

Nunca toca el volumen del usuario: exige un volumen propio y vacio, y lo retira al final.
Los PDF quedan en runtime/pdf-verification para revisarlos a ojo.
"""
import json
import re
from pathlib import Path
import subprocess
import time

IMAGE = 'biometric-attendance-payroll:1.0.0'
CONTAINER = 'verify-pdf'
VOLUME = 'verify-pdf-data'
ROOT = Path(__file__).resolve().parent.parent
SALIDA = ROOT / 'runtime/pdf-verification'
PASSWORD = 'Test-unified-4826'  # el mismo de unified/test_seed.py, solo para el fixture


def command(args, **kwargs):
    result = subprocess.run(args, capture_output=True, **kwargs)
    if result.returncode:
        detail = result.stderr.decode(errors='replace') if isinstance(result.stderr, bytes) else result.stderr
        print(detail, flush=True)
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
import base64, json, sqlite3, urllib.request, http.cookiejar
jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
def call(path, data=None, method=None, crudo=False):
    request = urllib.request.Request('http://127.0.0.1:3001' + path,
        data=json.dumps(data).encode() if data is not None else None,
        headers={'Content-Type': 'application/json', 'Origin': 'http://localhost:8080'},
        method=method)
    with opener.open(request, timeout=20) as response:
        return response.read() if crudo else json.load(response)
call('/api/admin/login', {'password': '__CLAVE__'})

persona = call('/api/admin/employees', {'code': 'PDF01', 'name': 'Ana Maria Rojas',
    'document': '1001002', 'role': 'Cocina', 'monthly_salary': 1750905,
    'transport_eligible': True, 'pin': '4321', 'rest_day': 7, 'active': True})['id']
otra = call('/api/admin/employees', {'code': 'PDF02', 'name': 'Carlos Hernandez',
    'document': '1001003', 'role': 'Hornero', 'monthly_salary': 1750905,
    'transport_eligible': True, 'pin': '4322', 'rest_day': 7, 'active': True})['id']

# Jornadas que producen ordinaria, nocturna y extra para que el desglose no salga vacio.
base = sqlite3.connect('/data/turnos/attendance-payroll.sqlite')
for identificador, entrada, salida in [
    (persona, '2026-08-03T12:00:00.000Z', '2026-08-03T22:00:00.000Z'),
    (persona, '2026-08-04T13:00:00.000Z', '2026-08-04T21:00:00.000Z'),
    (otra, '2026-08-03T21:00:00.000Z', '2026-08-04T04:00:00.000Z'),
]:
    base.execute("INSERT INTO shifts (employee_id,clock_in,clock_out,source) VALUES (?,?,?,'test')",
                 (identificador, entrada, salida))
base.commit(); base.close()

call('/api/admin/bonuses', {'employee_id': persona, 'effective_date': '2026-08-07',
     'concept': 'Bonificacion por buen comportamiento', 'amount': 50000,
     'constitutes_salary': False})
call('/api/admin/bonuses', {'employee_id': persona, 'effective_date': '2026-08-10',
     'concept': 'Cumplimiento de metas', 'amount': 30000, 'constitutes_salary': True})

corrida = call('/api/admin/payroll', {'start_date': '2026-08-01', 'end_date': '2026-08-15'})
general = call('/api/admin/payroll/%s/pdf' % corrida['run_id'], crudo=True)
individual = call('/api/admin/payroll/%s/employee/%s/pdf' % (corrida['run_id'], persona), crudo=True)
fila = [e for e in corrida['entries'] if e['employee_id'] == persona][0]
print(json.dumps({
    'general': base64.b64encode(general).decode(),
    'individual': base64.b64encode(individual).decode(),
    'trabajadores': len(corrida['entries']),
    'neto': fila['net_total_cents'],
    'bonos': fila['bonus_total_cents'],
}))
""".replace('__CLAVE__', PASSWORD)


if __name__ == '__main__':
    for name, args in ((CONTAINER, ['docker', 'container', 'inspect', CONTAINER]),
                       (VOLUME, ['docker', 'volume', 'inspect', VOLUME])):
        if subprocess.run(args, capture_output=True).returncode == 0:
            raise RuntimeError('Ya existe ' + name + '; revisalo antes de repetir la prueba')
    command(['docker', 'volume', 'create', VOLUME])
    command(['docker', 'run', '--rm', '--network', 'none', '-v', VOLUME + ':/data', '--entrypoint', 'python', IMAGE,
             '-c', (ROOT / 'unified/test_seed.py').read_text(encoding='utf-8')])
    command(['docker', 'run', '-d', '--name', CONTAINER, '--network', 'none', '--read-only', '--tmpfs', '/tmp',
             '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--stop-timeout', '45',
             '-v', VOLUME + ':/data', IMAGE])
    try:
        ready()
        import base64
        r = json.loads(command(['docker', 'exec', '-i', CONTAINER, 'python', '-'],
                               input=GUION.encode('utf-8'), text=False).stdout)
        SALIDA.mkdir(parents=True, exist_ok=True)
        archivos = {}
        for clave in ('general', 'individual'):
            datos = base64.b64decode(r[clave])
            destino = SALIDA / ('liquidacion-%s.pdf' % clave)
            destino.write_bytes(datos)
            archivos[clave] = (destino, datos)
        for clave, (destino, datos) in archivos.items():
            assert datos[:5] == b'%PDF-', (clave, datos[:20])
            assert datos.rstrip()[-5:] == b'%%EOF', (clave, datos[-20:])
            # Nunito incrustada y logo presente: sin esto el PDF no lleva la marca.
            assert b'Nunito' in datos, clave
            assert b'/Image' in datos, clave
            assert len(datos) > 40000, (clave, len(datos))
            # Sin hojas de sobra: un texto que pasa del margen inferior hace que
            # pdfkit añada paginas vacias, y eso ya ocurrio una vez.
            paginas = len(re.findall(rb'/Type\s*/Page(?![s])', datos))
            assert paginas == 1, (clave, 'paginas', paginas)
        assert r['trabajadores'] == 2, r
        assert r['bonos'] == 8000000, r
        print('PDF_NOMINA_OK ' + json.dumps({
            'trabajadores': r['trabajadores'],
            'neto': r['neto'],
            'bonos': r['bonos'],
            'bytes': {c: len(d) for c, (_, d) in archivos.items()},
            'archivos': [str(p) for p, _ in archivos.values()],
        }), flush=True)
    finally:
        subprocess.run(['docker', 'rm', '-f', CONTAINER], capture_output=True)
        subprocess.run(['docker', 'volume', 'rm', VOLUME], capture_output=True)
        print('Instalacion desechable retirada.', flush=True)
