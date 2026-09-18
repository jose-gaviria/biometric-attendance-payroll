"""Run all-in-one regression with an isolated Docker volume and no network."""
import base64
import json
from pathlib import Path
import subprocess
import time

IMAGE = 'biometric-attendance-payroll:1.0.0'
CONTAINER = 'verify-unified'
VOLUME = 'verify-data'
ROOT = Path(__file__).resolve().parent.parent


def command(args, **kwargs):
    result = subprocess.run(args, capture_output=True, **kwargs)
    if result.returncode:
        print(result.stderr.decode(errors='replace') if isinstance(result.stderr, bytes) else result.stderr, flush=True)
        raise RuntimeError('Fallo de comprobacion: ' + args[0] + ' (codigo ' + str(result.returncode) + ')')
    return result


def ready():
    for _ in range(45):
        result = subprocess.run(['docker','exec',CONTAINER,'python','/opt/unified/health.py'],capture_output=True)
        if result.returncode == 0:
            return
        time.sleep(2)
    raise RuntimeError('El contenedor de prueba no recupero la salud')


def start():
    command(['docker','run','-d','--name',CONTAINER,'--network','none','--read-only','--tmpfs','/tmp',
             '--cap-drop','ALL','--security-opt','no-new-privileges:true','--stop-timeout','45',
             '-v',VOLUME+':/data',IMAGE])
    ready()


def counts():
    code="import sqlite3,json;print(json.dumps({name:sqlite3.connect('/data/'+folder+'/'+file).execute('SELECT count(*) FROM '+name).fetchone()[0] for folder,file,name in [('turnos','attendance-payroll.sqlite','employees'),('turnos','attendance-payroll.sqlite','shifts'),('turnos','attendance-payroll.sqlite','face_links'),('face','face-lab.sqlite','face_templates')]}))"
    return json.loads(command(['docker','exec',CONTAINER,'python','-c',code],text=True).stdout)


if __name__ == '__main__':
    if subprocess.run(['docker','container','inspect',CONTAINER],capture_output=True).returncode==0:
        raise RuntimeError('Existe el contenedor de prueba; conservar y revisar antes de repetir')
    if subprocess.run(['docker','volume','inspect',VOLUME],capture_output=True).returncode==0:
        raise RuntimeError('Existe el volumen de prueba; no sobrescribirlo')
    command(['docker','volume','create',VOLUME])
    command(['docker','run','--rm','--network','none','-v',VOLUME+':/data','--entrypoint','python',IMAGE,
             '-c',(ROOT/'unified/test_seed.py').read_text(encoding='utf-8')])
    start()
    print('Contenedor listo, sin red ni carpetas montadas.',flush=True)
    fixture=(ROOT/'tests/fixtures/astronaut.png').read_bytes()
    result=command(['docker','exec','-i',CONTAINER,'python','-c',(ROOT/'unified/test_flow.py').read_text(encoding='utf-8')],
                   input=json.dumps({'image':base64.b64encode(fixture).decode()}),text=True)
    print(result.stdout,flush=True)
    before=counts()
    for marker in ['node-turnos','uvicorn','dist/server/server/index.js']:
        kill=r"""import os,signal
from pathlib import Path
marker=%r
for p in Path('/proc').iterdir():
 if p.name.isdigit() and int(p.name)!=os.getpid():
  try:
   args=(p/'cmdline').read_bytes().split(b'\0')
   if marker.encode() in args:
    os.kill(int(p.name),signal.SIGKILL);print('Servicio de prueba interrumpido');break
  except (FileNotFoundError,PermissionError,ProcessLookupError):pass
else:raise RuntimeError('Proceso de prueba no encontrado')
""" % marker
        command(['docker','exec',CONTAINER,'python','-c',kill])
        time.sleep(2)
        ready()
        print('Recuperacion verificada: '+marker,flush=True)
    command(['docker','stop',CONTAINER])
    command(['docker','start',CONTAINER])
    ready()
    assert counts()==before
    command(['docker','exec',CONTAINER,'python','/opt/unified/backup.py'])
    command(['docker','stop',CONTAINER])
    command(['docker','rm',CONTAINER])
    start()
    assert counts()==before
    details=json.loads(command(['docker','inspect',CONTAINER],text=True).stdout)[0]
    assert details['HostConfig']['NetworkMode']=='none'
    assert all(m['Type']=='volume' for m in details['Mounts'])
    report={'no_external_network':True,'no_host_bind_mounts':True,'services_recovered':3,
            'stop_start_preserves_data':True,'recreation_preserves_data':True,'counts':before}
    (ROOT/'runtime/unified-verification').mkdir(parents=True,exist_ok=True)
    (ROOT/'runtime/unified-verification/report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print('UNIFIED_VERIFIED '+json.dumps(report),flush=True)
    # La instalacion real es de un solo contenedor: la prueba no puede dejar otro encendido.
    command(['docker','rm','-f',CONTAINER])
    command(['docker','volume','rm',VOLUME])
    print('Instalacion desechable retirada.',flush=True)
