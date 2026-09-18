# Comprueba el traslado completo tal y como lo vivira el equipo de destino:
# se extrae el ZIP, se ejecuta su propio instalador, se entra con la clave que
# se tecleo y se crea un trabajador. Todo con nombres desechables, sin tocar la
# instalacion real, y se retira al terminar.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $PSScriptRoot
$contenedor = 'prueba-portable'
$volumen = 'prueba-portable-data'
$clave = 'Clave-De-Prueba-2026'
$destino = Join-Path ([IO.Path]::GetTempPath()) ('prueba-portable-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))

$zip = Get-ChildItem (Join-Path $projectRoot 'runtime\portable\*.zip') -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime | Select-Object -Last 1
if (-not $zip) { throw 'No hay paquete en runtime\portable. Ejecuta export-offline.bat primero.' }
Write-Output "Paquete: $($zip.Name) ($([math]::Round($zip.Length / 1MB, 1)) MB)"

foreach ($nombre in @($contenedor)) {
    if ((docker ps -a --filter "name=^/${nombre}$" --format '{{.Names}}') -eq $nombre) { throw "Ya existe $nombre" }
}
if ((docker volume ls --filter "name=^${volumen}$" --format '{{.Name}}') -eq $volumen) { throw "Ya existe $volumen" }

try {
    Expand-Archive -LiteralPath $zip.FullName -DestinationPath $destino
    # El paquete no puede llevar datos de nadie.
    $manifiesto = Get-Content -Raw -LiteralPath (Join-Path $destino 'MANIFEST.json') | ConvertFrom-Json
    if ($manifiesto.includes_private_data) { throw 'El paquete declara datos privados dentro.' }
    foreach ($prohibido in @('data.tar.gz', 'scripts\restore.py')) {
        if (Test-Path -LiteralPath (Join-Path $destino $prohibido)) { throw "El paquete trae $prohibido" }
    }

    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $destino 'scripts\install-offline.ps1') `
        -SinAutoarranque -Contenedor $contenedor -Volumen $volumen
    if ($LASTEXITCODE -ne 0) { throw 'El instalador del paquete fallo.' }

    # La instalacion llega sin clave: la define quien entra por primera vez.
    $guion = @"
import json, urllib.request, urllib.error, http.cookiejar
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
sesion = call('/api/admin/session')[1]
assert sesion == {'authenticated': False, 'configured': False}, sesion
assert call('/api/admin/password/setup',
            {'password': '$clave', 'confirm': '$clave'})[0] == 201
assert call('/api/admin/session')[1]['configured'] is True
assert call('/api/admin/login', {'password': '$clave'})[0] == 200, 'la clave definida no sirve'
creado = call('/api/admin/employees', {'code': 'C1', 'name': 'Prueba Instalacion', 'document': '1',
    'role': 'Cocina', 'monthly_salary': 1750905, 'transport_eligible': True, 'pin': '4321',
    'rest_day': 7, 'active': True})
assert creado[0] == 201, creado
assert len(call('/api/kiosk/employees')[1]) == 1
trabajador = call('/api/admin/employees')[1][0]
assert trabajador['name'] == 'Prueba Instalacion' and trabajador['rest_day'] == 7
assert call('/api/face/profiles')[0] == 200
print('INSTALACION_PORTABLE_OK')
"@
    $guion | & docker exec -i $contenedor python -
    if ($LASTEXITCODE -ne 0) { throw 'La instalacion recien creada no respondio como debe.' }
} finally {
    docker rm -f $contenedor 2>&1 | Out-Null
    docker volume rm $volumen 2>&1 | Out-Null
    if (Test-Path -LiteralPath $destino) { Remove-Item -LiteralPath $destino -Recurse -Force }
    Write-Output 'Instalacion de prueba retirada.'
}
