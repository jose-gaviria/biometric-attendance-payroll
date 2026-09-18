"""Regla automática de 7 horas y descanso semanal: camino HTTP desechable."""
import json
from pathlib import Path
import subprocess
import time

IMAGE = 'biometric-attendance-payroll:1.0.0'
CONTAINER = 'verify-daily-hours'
VOLUME = 'verify-daily-hours-data'
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
    raise RuntimeError('El contenedor de prueba no alcanzó la salud')


CLIENT = r'''
import json, sqlite3, urllib.request, urllib.error, http.cookiejar
jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
def call(path, data=None, method=None):
    request = urllib.request.Request('http://127.0.0.1:3001' + path,
        data=json.dumps(data).encode() if data is not None else None,
        headers={'Content-Type':'application/json','Origin':'http://localhost:8080'}, method=method)
    try:
        with opener.open(request, timeout=15) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, json.load(error)
assert call('/api/admin/login', {'password': %r})[0] == 200
employee_id = call('/api/admin/employees', {
    'code':'DIARIA','name':'Jornada Diaria','document':'1','role':'Operario',
    'monthly_salary':1750905,'transport_eligible':True,'pin':'4321',
    'rest_day':2,'active':True})[1]['id']
employee = [row for row in call('/api/admin/employees')[1] if row['id'] == employee_id][0]

db = sqlite3.connect('/data/turnos/attendance-payroll.sqlite')
# Lunes: ocho horas continuas.
db.execute("INSERT INTO shifts(employee_id,clock_in,clock_out,source) VALUES(?,?,?,'test')",
           (employee_id,'2026-08-03T13:00:00.000Z','2026-08-03T21:00:00.000Z'))
# Martes: el descanso recurrente también separa siete horas y la octava extra.
db.execute("INSERT INTO shifts(employee_id,clock_in,clock_out,source) VALUES(?,?,?,'test')",
           (employee_id,'2026-08-04T13:00:00.000Z','2026-08-04T21:00:00.000Z'))
# Miércoles: dos turnos suman el mismo contador diario.
db.execute("INSERT INTO shifts(employee_id,clock_in,clock_out,source) VALUES(?,?,?,'test')",
           (employee_id,'2026-08-05T13:00:00.000Z','2026-08-05T17:00:00.000Z'))
db.execute("INSERT INTO shifts(employee_id,clock_in,clock_out,source) VALUES(?,?,?,'test')",
           (employee_id,'2026-08-05T18:00:00.000Z','2026-08-05T22:00:00.000Z'))
db.commit(); db.close()

overlap = call('/api/admin/shifts', {
    'employee_id':employee_id,'clock_in':'2026-08-03T08:30',
    'clock_out':'2026-08-03T09:00','note':'Debe rechazarse'}, 'POST')[0]
status, payroll = call('/api/admin/payroll', {'start_date':'2026-08-01','end_date':'2026-08-15'})
lines = {line['category']:line['hours'] for line in payroll['entries'][0]['breakdown']}
retired_schedule_status = call('/api/admin/schedules?week=2026-08-03')[0]
print(json.dumps({'status':status,'rest_day':employee['rest_day'],'overlap':overlap,
                  'retired_schedule_status':retired_schedule_status,'hours':lines}))
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
        assert result['status'] == 200, result
        assert result['rest_day'] == 2, result
        assert result['overlap'] == 409, result
        assert result['retired_schedule_status'] == 404, result
        assert result['hours']['ordinary_day'] == 14, result
        assert result['hours']['overtime_day'] == 2, result
        assert result['hours']['rest_day_day'] == 7, result
        assert result['hours']['overtime_rest_day'] == 1, result
        print('JORNADA_DIARIA_OK ' + json.dumps(result), flush=True)
    finally:
        subprocess.run(['docker','rm','-f',CONTAINER], capture_output=True)
        subprocess.run(['docker','volume','rm',VOLUME], capture_output=True)
        print('Instalación desechable retirada.', flush=True)
