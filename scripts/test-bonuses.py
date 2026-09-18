"""Bonificaciones de la quincena: camino HTTP completo en una instalacion desechable.

Las pruebas unitarias de Turnos fijan el calculo. Esto comprueba lo demas: crear la
bonificacion por API, que la liquidacion real la sume al total, que solo la marcada
como salarial toque el IBC, y que borrarla vuelva a bajar el total.

Nunca toca el volumen del usuario: exige un volumen propio y vacio, y lo retira al final.
"""
import json
from pathlib import Path
import subprocess
import time

IMAGE = 'biometric-attendance-payroll:1.0.0'
CONTAINER = 'verify-bonuses'
VOLUME = 'verify-bonuses-data'
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


CLIENTE = """
import json, urllib.request, http.cookiejar
jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
def call(path, data=None, method=None):
    request = urllib.request.Request('http://127.0.0.1:3001' + path,
        data=json.dumps(data).encode() if data is not None else None,
        headers={'Content-Type': 'application/json', 'Origin': 'http://localhost:8080'},
        method=method)
    with opener.open(request, timeout=15) as response:
        return json.load(response)
call('/api/admin/login', {'password': %r})

persona = call('/api/admin/employees', {'code': 'BONO', 'name': 'Ana Prueba', 'document': '1',
    'role': 'Operaria', 'monthly_salary': 1750905, 'transport_eligible': True,
    'pin': '4321', 'rest_day': 7, 'active': True})['id']

sin_bonos = call('/api/admin/payroll', {'start_date': '2026-08-01', 'end_date': '2026-08-15'})
antes = [e for e in sin_bonos['entries'] if e['employee_id'] == persona][0]

premio = call('/api/admin/bonuses', {'employee_id': persona, 'effective_date': '2026-08-07',
    'concept': 'Bonificacion por buen comportamiento', 'amount': 50000,
    'constitutes_salary': False, 'note': 'Decision del jefe'})['id']
call('/api/admin/bonuses', {'employee_id': persona, 'effective_date': '2026-08-10',
    'concept': 'Cumplimiento de metas', 'amount': 30000, 'constitutes_salary': True})

# Fuera de la quincena: no debe entrar en este calculo.
call('/api/admin/bonuses', {'employee_id': persona, 'effective_date': '2026-08-20',
    'concept': 'Fuera de la quincena', 'amount': 90000, 'constitutes_salary': False})

listado = call('/api/admin/bonuses?start_date=2026-08-01&end_date=2026-08-15')
con_bonos = call('/api/admin/payroll', {'start_date': '2026-08-01', 'end_date': '2026-08-15'})
despues = [e for e in con_bonos['entries'] if e['employee_id'] == persona][0]

call('/api/admin/bonuses/' + str(premio), method='DELETE')
tras_borrar = call('/api/admin/payroll', {'start_date': '2026-08-01', 'end_date': '2026-08-15'})
final = [e for e in tras_borrar['entries'] if e['employee_id'] == persona][0]

print(json.dumps({
    'listado': len(listado),
    'conceptos': [b['concept'] for b in listado],
    'antes': {k: antes[k] for k in ('gross_total_cents','ibc_cents','total_deductions_cents','net_total_cents')},
    'despues': {k: despues[k] for k in ('gross_total_cents','ibc_cents','total_deductions_cents','net_total_cents')},
    'bonos_liquidados': len(despues['bonuses']),
    'bono_total': despues['bonus_total_cents'],
    'bono_salarial': despues['bonus_salary_cents'],
    'bono_no_salarial': despues['bonus_non_salary_cents'],
    'exceso_no_salarial': despues['non_salary_excess_cents'],
    'final_bruto': final['gross_total_cents'],
    'final_bonos': final['bonus_total_cents'],
    'guardado': [e['bonus_total_cents'] for e in call('/api/admin/payroll/' + str(con_bonos['run_id']))['entries']
                 if e['employee_id'] == persona][0],
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
        salida = command(['docker','exec','-i',CONTAINER,'python','-'],
                         input=CLIENTE.encode('utf-8'), text=False).stdout
        r = json.loads(salida)
        # Solo las dos bonificaciones de la quincena; la del 20 de agosto queda fuera.
        assert r['listado'] == 2, r
        assert r['bonos_liquidados'] == 2, r
        assert r['bono_total'] == 8000000, r
        assert r['bono_salarial'] == 3000000, r
        assert r['bono_no_salarial'] == 5000000, r
        assert r['exceso_no_salarial'] == 0, r
        # El bruto sube con las dos; el IBC solo con la salarial.
        assert r['despues']['gross_total_cents'] == r['antes']['gross_total_cents'] + 8000000, r
        assert r['despues']['ibc_cents'] == r['antes']['ibc_cents'] + 3000000, r
        assert r['despues']['total_deductions_cents'] > r['antes']['total_deductions_cents'], r
        assert (r['despues']['net_total_cents']
                == r['despues']['gross_total_cents'] - r['despues']['total_deductions_cents']), r
        # Al borrar la no salarial, el total baja justo ese valor.
        assert r['final_bonos'] == 3000000, r
        assert r['final_bruto'] == r['despues']['gross_total_cents'] - 5000000, r
        # La liquidacion guardada conserva su copia pese al borrado posterior.
        assert r['guardado'] == 8000000, r
        print('BONIFICACIONES_OK ' + json.dumps(r), flush=True)
    finally:
        subprocess.run(['docker','rm','-f',CONTAINER], capture_output=True)
        subprocess.run(['docker','volume','rm',VOLUME], capture_output=True)
        print('Instalacion desechable retirada.', flush=True)
