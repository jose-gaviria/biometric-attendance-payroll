"""Eliminar trabajadores y caducidad de liquidaciones: camino HTTP completo.

Comprueba lo que pidio el usuario: al borrar a alguien desaparece todo lo suyo de
la base, pero sus liquidaciones guardadas siguen consultables con su nombre y sus
montos; y las liquidaciones se retiran solas cuando su quincena pasa de dos meses.

Nunca toca el volumen del usuario: exige un volumen propio y vacio, y lo retira al final.
"""
import json
from pathlib import Path
import subprocess
import time

IMAGE = 'biometric-attendance-payroll:1.0.0'
CONTAINER = 'verify-deletion'
VOLUME = 'verify-deletion-data'
ROOT = Path(__file__).resolve().parent.parent
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
        if subprocess.run(['docker','exec',CONTAINER,'python','/opt/unified/health.py'],
                          capture_output=True).returncode == 0:
            return
        time.sleep(2)
    raise RuntimeError('El contenedor de prueba no alcanzo la salud')


GUION = """
import json, sqlite3, urllib.request, urllib.error, http.cookiejar
jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
def call(path, data=None, method=None):
    request = urllib.request.Request('http://127.0.0.1:3001' + path,
        data=json.dumps(data).encode() if data is not None else None,
        headers={'Content-Type': 'application/json', 'Origin': 'http://localhost:8080'},
        method=method)
    try:
        with opener.open(request, timeout=15) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, json.load(error)
call('/api/admin/login', {'password': %r})

def crear(code, name):
    return call('/api/admin/employees', {'code': code, 'name': name, 'document': '1',
        'role': 'Operario', 'monthly_salary': 1750905, 'transport_eligible': True,
        'pin': '4321', 'rest_day': 7, 'active': True})[1]['id']

RUTA = '/data/turnos/attendance-payroll.sqlite'

# --- Alguien sin liquidacion guardada: se borra con todo lo suyo ---
sobra = crear('SOBRA', 'Persona Sobrante')
base = sqlite3.connect(RUTA)
base.execute("INSERT INTO shifts (employee_id,clock_in,clock_out,source) VALUES (?,?,?,'test')",
             (sobra, '2026-08-03T13:00:00.000Z', '2026-08-03T21:00:00.000Z'))
base.commit(); base.close()
# Rostro real en la base facial, vinculado por el mismo camino que usa la interfaz.
perfil = call('/api/face/profiles', {'display_name': 'Persona Sobrante'})[1]['id']
call('/api/face/links/' + str(sobra), {'profile_id': perfil}, method='PUT')
ROSTROS = '/data/face/face-lab.sqlite'
facial = sqlite3.connect(ROSTROS)
perfiles_antes = facial.execute('SELECT count(*) FROM face_profiles WHERE id=?', (perfil,)).fetchone()[0]
facial.close()
call('/api/admin/bonuses', {'employee_id': sobra, 'effective_date': '2026-08-05',
     'concept': 'Bono de prueba', 'amount': 10000, 'constitutes_salary': False})

antes = call('/api/admin/employees/' + str(sobra) + '/deletion')[1]
borrado = call('/api/admin/employees/' + str(sobra), method='DELETE')
restos = {}
base = sqlite3.connect(RUTA)
for tabla in ('shifts', 'weekly_schedules', 'bonuses', 'face_links', 'employees'):
    columna = 'id' if tabla == 'employees' else 'employee_id'
    restos[tabla] = base.execute(
        'SELECT count(*) FROM ' + tabla + ' WHERE ' + columna + '=?', (sobra,)).fetchone()[0]
auditoria = base.execute(
    "SELECT count(*) FROM audit_log WHERE action='employee_deleted' AND entity_id=?", (sobra,)).fetchone()[0]
base.close()
facial = sqlite3.connect(ROSTROS)
perfiles_despues = facial.execute('SELECT count(*) FROM face_profiles WHERE id=?', (perfil,)).fetchone()[0]
facial.close()
# Se consulta la lista aqui: al crear el siguiente trabajador SQLite puede
# reutilizar el id recien liberado y la comprobacion dejaria de significar nada.
fuera = all(e['id'] != sobra for e in call('/api/admin/employees')[1])

# --- Quien ya fue liquidado tambien se borra, y su liquidacion sobrevive ---
liquidado = crear('NOMINA', 'Persona Liquidada')
reciente = call('/api/admin/payroll', {'start_date': '2026-08-01', 'end_date': '2026-08-15'})[1]
resumen = call('/api/admin/employees/' + str(liquidado) + '/deletion')[1]
borrado_liquidado = call('/api/admin/employees/' + str(liquidado), method='DELETE')
guardada = call('/api/admin/payroll/' + str(reciente['run_id']))[1]
nombres = [e['employee_name'] for e in guardada['entries']]
lista = call('/api/admin/employees')[1]
# Un alta posterior no puede heredar el identificador conservado en la
# liquidación histórica de otra persona.
nuevo = crear('NUEVO', 'Persona Nueva')
impacto_nuevo = call('/api/admin/employees/' + str(nuevo) + '/deletion')[1]

# --- Una quincena vieja se retira sola ---
vieja = call('/api/admin/payroll', {'start_date': '2026-06-01', 'end_date': '2026-06-15'})[1]
corridas = call('/api/admin/payroll-runs')[1]
base = sqlite3.connect(RUTA)
caducidad = base.execute(
    "SELECT count(*) FROM audit_log WHERE action='payroll_expired' AND entity_id=?",
    (vieja['run_id'],)).fetchone()[0]
huerfanas = base.execute(
    'SELECT count(*) FROM payroll_entries WHERE payroll_run_id=?', (vieja['run_id'],)).fetchone()[0]
base.close()

print(json.dumps({
    'antes': {k: antes[k] for k in ('shifts','weekly_schedules','bonuses','face_links','payroll_entries','can_delete')},
    'borrado_estado': borrado[0],
    'restos': restos,
    'auditoria': auditoria,
    'borrado_fuera_de_lista': fuera,
    'perfil_facial_antes': perfiles_antes,
    'perfil_facial_despues': perfiles_despues,
    'resumen_liquidado': {k: resumen[k] for k in ('payroll_entries','can_delete')},
    'borrado_liquidado_estado': borrado_liquidado[0],
    'liquidacion_conserva_nombre': 'Persona Liquidada' in nombres,
    'liquidado_fuera_de_lista': all(e['id'] != liquidado for e in lista),
    'id_historico_no_reutilizado': nuevo != liquidado,
    'liquidaciones_del_nuevo': impacto_nuevo['payroll_entries'],
    'vieja_sigue': any(c['id'] == vieja['run_id'] for c in corridas),
    'reciente_sigue': any(c['id'] == reciente['run_id'] for c in corridas),
    'auditoria_caducidad': caducidad,
    'entradas_huerfanas': huerfanas,
}))
""" % PASSWORD


if __name__ == '__main__':
    for name, args in ((CONTAINER, ['docker','container','inspect',CONTAINER]),
                       (VOLUME, ['docker','volume','inspect',VOLUME])):
        if subprocess.run(args, capture_output=True).returncode == 0:
            raise RuntimeError('Ya existe ' + name + '; revisalo antes de repetir la prueba')
    command(['docker','volume','create',VOLUME])
    command(['docker','run','--rm','--network','none','-v',VOLUME+':/data','--entrypoint','python',IMAGE,
             '-c',(ROOT/'unified/test_seed.py').read_text(encoding='utf-8')])
    command(['docker','run','-d','--name',CONTAINER,'--network','none','--read-only','--tmpfs','/tmp',
             '--cap-drop','ALL','--security-opt','no-new-privileges:true','--stop-timeout','45',
             '-v',VOLUME+':/data',IMAGE])
    try:
        ready()
        r = json.loads(command(['docker','exec','-i',CONTAINER,'python','-'],
                               input=GUION.encode('utf-8'), text=False).stdout)
        # Se anuncia exactamente lo que se va a perder.
        assert r['antes'] == {'shifts': 1, 'weekly_schedules': 0, 'bonuses': 1,
                              'face_links': 1, 'payroll_entries': 0, 'can_delete': True}, r
        assert r['borrado_estado'] == 200, r
        # Y no queda nada suyo en ninguna tabla.
        assert all(total == 0 for total in r['restos'].values()), r
        assert r['auditoria'] == 1, r
        assert r['borrado_fuera_de_lista'], r
        # El rostro existia en la base facial y desaparecio con el trabajador.
        assert r['perfil_facial_antes'] == 1, r
        assert r['perfil_facial_despues'] == 0, r
        # Quien ya fue liquidado tambien se borra; su liquidacion queda intacta.
        assert r['resumen_liquidado'] == {'payroll_entries': 1, 'can_delete': True}, r
        assert r['borrado_liquidado_estado'] == 200, r
        assert r['liquidacion_conserva_nombre'], r
        assert r['liquidado_fuera_de_lista'], r
        assert r['id_historico_no_reutilizado'], r
        assert r['liquidaciones_del_nuevo'] == 0, r
        # La quincena de junio supera los dos meses y se retira sola.
        assert r['vieja_sigue'] is False, r
        assert r['reciente_sigue'] is True, r
        assert r['auditoria_caducidad'] == 1, r
        assert r['entradas_huerfanas'] == 0, r
        print('BORRADO_TRABAJADORES_OK ' + json.dumps(r), flush=True)
    finally:
        subprocess.run(['docker','rm','-f',CONTAINER], capture_output=True)
        subprocess.run(['docker','volume','rm',VOLUME], capture_output=True)
        print('Instalacion desechable retirada.', flush=True)
