"""Audita por HTTP las reglas laborales vigentes sin tocar datos reales."""
import json
from pathlib import Path
import subprocess
import time

IMAGE = 'biometric-attendance-payroll:1.0.0'
CONTAINER = 'verify-payroll-legal'
VOLUME = 'verify-payroll-legal-data'
ROOT = Path(__file__).resolve().parent.parent
PASSWORD = 'Test-unified-4826'


def command(args, **kwargs):
    result = subprocess.run(args, capture_output=True, **kwargs)
    if result.returncode:
        detail = result.stderr.decode(errors='replace') if isinstance(result.stderr, bytes) else result.stderr
        raise RuntimeError(f'{args[0]} falló ({result.returncode}): {detail}')
    return result


def ready():
    for _ in range(45):
        if subprocess.run(['docker', 'exec', CONTAINER, 'python', '/opt/unified/health.py'],
                          capture_output=True).returncode == 0:
            return
        time.sleep(2)
    raise RuntimeError('El contenedor no alcanzó la salud')


CLIENT = r'''
import json, sqlite3, urllib.request, urllib.error, http.cookiejar
jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
def request(path, data=None, method=None):
    req = urllib.request.Request('http://127.0.0.1:3001' + path,
        data=json.dumps(data).encode() if data is not None else None,
        headers={'Content-Type':'application/json','Origin':'http://localhost:8080'}, method=method)
    try:
        with opener.open(req, timeout=15) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, json.load(error)
assert request('/api/admin/login', {'password': %r})[0] == 200
employee_id = request('/api/admin/employees', {
    'code':'LEGAL','name':'Auditoría Legal','document':'1','role':'Operario',
    'monthly_salary':9000000,'transport_eligible':True,'pin':'4321',
    'rest_day':7,'active':True})[1]['id']
employee = [row for row in request('/api/admin/employees')[1] if row['id'] == employee_id][0]
db = sqlite3.connect('/data/turnos/attendance-payroll.sqlite')
# Lunes 3: diez horas; las primeras siete son ordinarias y tres son extras.
db.execute("INSERT INTO shifts(employee_id,clock_in,clock_out,source) VALUES(?,?,?,'test')",
           (employee_id,'2026-08-03T12:00:00.000Z','2026-08-03T22:00:00.000Z'))
# Cruce exacto 18:59:30–19:00:30 para probar la frontera nocturna por segundos.
db.execute("INSERT INTO shifts(employee_id,clock_in,clock_out,source) VALUES(?,?,?,'test')",
           (employee_id,'2026-08-04T23:59:30.000Z','2026-08-05T00:00:30.000Z'))
db.commit(); db.close()
status, payroll = request('/api/admin/payroll', {'start_date':'2026-08-01','end_date':'2026-08-15'})
entry = payroll['entries'][0]
lines = {line['category']:line for line in entry['breakdown']}
immutable = request('/api/admin/legal-rules', {'effective_from':'2026-07-15',
    'minimum_salary':1,'transport_allowance':0,'weekly_hours':48,
    'night_start_hour':21,'rest_day_surcharge':0}, 'POST')[0]
future = request('/api/admin/payroll', {'start_date':'2027-08-01','end_date':'2027-08-15'})[0]
print(json.dumps({'payroll_status':status,'stored_salary':employee['monthly_salary_cents'],
    'base_salary':entry['base_salary_cents'],'ordinary_day_h':lines['ordinary_day']['hours'],
    'overtime_day_h':lines['overtime_day']['hours'],
    'ordinary_night_minutes':lines['ordinary_night']['minutes'],
    'health':entry['health_deduction_cents'],'pension':entry['pension_deduction_cents'],
    'immutable_status':immutable,'future_status':future}))
''' % PASSWORD


if __name__ == '__main__':
    for name, args in ((CONTAINER, ['docker','container','inspect',CONTAINER]),
                       (VOLUME, ['docker','volume','inspect',VOLUME])):
        if subprocess.run(args, capture_output=True).returncode == 0:
            raise RuntimeError(f'Ya existe {name}; revísalo antes de repetir la prueba')
    command(['docker','volume','create',VOLUME])
    command(['docker','run','--rm','--network','none','-v',VOLUME+':/data','--entrypoint','python',IMAGE,
             '-c',(ROOT/'unified/test_seed.py').read_text(encoding='utf-8')])
    command(['docker','run','-d','--name',CONTAINER,'--network','none','--read-only','--tmpfs','/tmp',
             '--cap-drop','ALL','--security-opt','no-new-privileges:true','--stop-timeout','45',
             '-v',VOLUME+':/data',IMAGE])
    try:
        ready()
        result = json.loads(command(['docker','exec','-i',CONTAINER,'python','-'],
                            input=CLIENT.encode(), text=False).stdout)
        assert result['payroll_status'] == 200, result
        assert result['stored_salary'] == 175090500 == result['base_salary'] * 2, result
        assert result['ordinary_day_h'] == 7.01, result
        assert result['overtime_day_h'] == 3, result
        assert result['ordinary_night_minutes'] == 0.5, result
        assert result['health'] == result['pension'] > 0, result
        assert result['immutable_status'] == 409, result
        assert result['future_status'] == 409, result
        print('AUDITORIA_NOMINA_LEGAL_OK ' + json.dumps(result), flush=True)
    finally:
        subprocess.run(['docker','rm','-f',CONTAINER], capture_output=True)
        subprocess.run(['docker','volume','rm',VOLUME], capture_output=True)
        print('Instalación desechable retirada.', flush=True)
