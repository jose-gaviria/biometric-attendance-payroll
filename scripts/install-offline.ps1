# Instalacion nueva en el equipo de destino. No trae datos de nadie: crea un
# volumen vacio; la clave se define en el primer acceso al panel.
[CmdletBinding()]
param(
    # Deja el equipo encendiendo el sistema solo al iniciar sesion en Windows.
    [switch]$SinAutoarranque,
    # Nombres alternativos, solo para comprobar el paquete sin tocar una
    # instalacion existente. En un equipo real no se usan.
    [string]$Contenedor = 'registro-de-entradas',
    [string]$Volumen = 'biometric-attendance-payroll-data'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$bundleRoot = Split-Path -Parent $PSScriptRoot
$image = 'biometric-attendance-payroll:1.0.0'
$container = $Contenedor
$volume = $Volumen

function Invoke-Docker([string[]]$Arguments) {
    & docker @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Docker no completo: $($Arguments -join ' ')" }
}

docker info --format '{{.ServerVersion}}' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop debe estar instalado y encendido.' }
$drive = New-Object IO.DriveInfo([IO.Path]::GetPathRoot([IO.Path]::GetFullPath($bundleRoot)))
if ($drive.AvailableFreeSpace -lt 6GB) { throw 'Se requieren al menos 6 GB libres para instalar.' }

Write-Output 'Comprobando que el paquete llegue completo...'
$hashes = Get-Content -Raw -LiteralPath (Join-Path $bundleRoot 'SHA256.json') | ConvertFrom-Json
foreach ($property in $hashes.PSObject.Properties) {
    $relative = $property.Name
    $candidate = [IO.Path]::GetFullPath((Join-Path $bundleRoot $relative))
    if (-not $candidate.StartsWith([IO.Path]::GetFullPath($bundleRoot) + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Ruta invalida en SHA256.json.' }
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { throw "Falta un archivo: $relative" }
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $candidate).Hash.ToLowerInvariant() -ne $property.Value) { throw "Archivo danado o modificado: $relative" }
}
if ((docker ps -a --filter "name=^/${container}$" --format '{{.Names}}') -eq $container) { throw "Ya existe un contenedor llamado $container. No se sobrescribio." }
if ((docker volume ls --filter "name=^${volume}$" --format '{{.Name}}') -eq $volume) { throw "Ya existe el volumen $volume. No se sobrescribio." }

Write-Output ''
$volumeCreated = $false
$installationReady = $false
try {
Write-Output '1/4 Cargando la aplicacion completa...'
Invoke-Docker @('load','-i',(Join-Path $bundleRoot 'image.tar'))
$null = Invoke-Docker @('image','inspect',$image)

Write-Output '2/4 Creando el almacenamiento e inicializando las bases...'
Invoke-Docker @('volume','create',$volume)
$volumeCreated = $true
# No se define ninguna clave aqui: la escribe el usuario la primera vez que
# entra al panel, y queda cifrada dentro de la base.
Invoke-Docker @('run','--rm','--network','none','-v',"${volume}:/data",'--entrypoint','python',$image,'/opt/unified/bootstrap.py')

Write-Output '3/4 Encendiendo...'
if ($container -eq 'registro-de-entradas' -and $volume -eq 'biometric-attendance-payroll-data') {
    Push-Location $bundleRoot
    try { Invoke-Docker @('compose','-f','compose.yaml','up','-d','--no-build','--pull','never') } finally { Pop-Location }
} else {
    Invoke-Docker @('run','-d','--name',$container,'--restart','unless-stopped','--stop-timeout','45',
        '--read-only','--tmpfs','/tmp:size=128m,mode=1777','--cap-drop','ALL',
        '--security-opt','no-new-privileges:true','-v',"${volume}:/data",$image)
}
$healthy = $false
for ($attempt=0; $attempt -lt 90; $attempt++) {
    if ((docker inspect $container --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' 2>$null) -eq 'healthy') { $healthy=$true; break }
    Start-Sleep -Seconds 2
}
if (-not $healthy) { throw 'El contenedor no alcanzo el estado healthy. Ejecuta status.bat.' }
Invoke-Docker @('exec',$container,'python','/opt/unified/health.py')

Write-Output '4/4 Comprobando que la instalacion quede vacia y sana...'
$contenido = docker exec $container python /opt/unified/verify_data.py | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'No se pudo comprobar el contenido inicial.' }
foreach ($tabla in @('employees','shifts','payroll_runs','face_links')) {
    if ($contenido.turnos.$tabla.count -ne 0) { throw "La instalacion no quedo vacia: turnos/$tabla" }
}
foreach ($tabla in @('face_profiles','face_templates')) {
    if ($contenido.face.$tabla.count -ne 0) { throw "La instalacion no quedo vacia: face/$tabla" }
}
$installationReady = $true
} catch {
    # Antes de quedar sana, toda instalación es desechable y debe retirarse
    # para que el usuario pueda corregir la causa y repetir el mismo instalador.
    # Una instalación ya verificada nunca se borra por un fallo posterior del
    # autoarranque de Windows.
    if (-not $installationReady) {
        & docker rm -f $container 2>$null | Out-Null
        if ($volumeCreated) { & docker volume rm $volume 2>$null | Out-Null }
    }
    throw
}

if (-not $SinAutoarranque) {
    Write-Output ''
    Write-Output 'Dejando el equipo encendiendo el sistema solo al iniciar sesion...'
    & (Join-Path $PSScriptRoot 'enable-autostart.ps1')
}

Write-Output ''
Write-Output 'INSTALACION_COMPLETA'
Write-Output 'Turnos: http://localhost:8080'
Write-Output 'Laboratorio facial: http://localhost:8091'
Write-Output ''
Write-Output 'Abre http://localhost:8080 y pulsa Administracion: la primera vez te pedira'
Write-Output 'que definas la clave del panel. Anotala, no hay forma de recuperarla.'
