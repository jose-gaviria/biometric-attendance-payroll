# Deja el equipo de produccion encendiendo solo: Docker Desktop arranca al iniciar
# sesion en Windows y, con el motor encendido, `restart: unless-stopped` vuelve a
# levantar el contenedor. Sin el motor, ninguna politica de reinicio puede actuar.
[CmdletBinding()]
param(
    # Escribe el ajuste sin cerrar Docker Desktop. El propio Docker puede
    # sobrescribir su archivo de ajustes al salir, asi que sin reinicio la
    # comprobacion final no es concluyente.
    [switch]$NoReiniciarDocker
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$container = 'registro-de-entradas'
$runKey = 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run'
$approvedKey = 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run'
$entry = 'Docker Desktop'
$settings = Join-Path $env:APPDATA 'Docker\settings-store.json'

function Find-DockerDesktop {
    $process = Get-Process 'Docker Desktop' -ErrorAction SilentlyContinue |
        Where-Object { $_.Path } | Select-Object -First 1
    if ($process) { return $process.Path }
    foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA)) {
        if (-not $base) { continue }
        $candidate = Join-Path $base 'Docker\Docker\Docker Desktop.exe'
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
    }
    throw 'No se encontro Docker Desktop instalado en este equipo.'
}

function Wait-DockerEngine([int]$Seconds = 240) {
    for ($attempt = 0; $attempt -lt $Seconds; $attempt++) {
        docker info --format '{{.ServerVersion}}' 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) { return }
        Start-Sleep -Seconds 1
    }
    throw 'El motor de Docker no respondio despues de encender Docker Desktop.'
}

$exe = Find-DockerDesktop
Write-Output "Docker Desktop: $exe"

# 1. Entrada de inicio de sesion, creada solo si falta.
$current = (Get-ItemProperty -LiteralPath $runKey -Name $entry -ErrorAction SilentlyContinue).$entry
if (-not $current) {
    New-ItemProperty -LiteralPath $runKey -Name $entry -Value $exe -PropertyType String -Force | Out-Null
    Write-Output 'Entrada de inicio creada.'
}

# 2. Windows guarda aparte si esa entrada esta habilitada; 0x02 la habilita.
if (-not (Test-Path -LiteralPath $approvedKey)) { New-Item -Path $approvedKey -Force | Out-Null }
$approval = New-Object byte[] 12
$approval[0] = 2
New-ItemProperty -LiteralPath $approvedKey -Name $entry -Value $approval -PropertyType Binary -Force | Out-Null
Write-Output 'Entrada de inicio habilitada en Windows.'

# 3. Ajuste propio de Docker Desktop. Se escribe con Docker cerrado para que no
#    lo sobrescriba al salir.
if (-not (Test-Path -LiteralPath $settings -PathType Leaf)) {
    throw "No se encontro el archivo de ajustes de Docker Desktop: $settings"
}
$running = @(Get-Process 'Docker Desktop' -ErrorAction SilentlyContinue)
if ($running.Count -gt 0 -and -not $NoReiniciarDocker) {
    Write-Output 'Cerrando Docker Desktop para escribir el ajuste...'
    & $exe -Shutdown
    for ($attempt = 0; $attempt -lt 120; $attempt++) {
        if (-not (Get-Process 'Docker Desktop' -ErrorAction SilentlyContinue)) { break }
        Start-Sleep -Seconds 1
    }
    Get-Process 'Docker Desktop' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

Copy-Item -LiteralPath $settings -Destination "$settings.bak" -Force
$store = Get-Content -Raw -LiteralPath $settings | ConvertFrom-Json
$store | Add-Member -NotePropertyName 'AutoStart' -NotePropertyValue $true -Force
$store | ConvertTo-Json -Depth 20 | Set-Content -Encoding utf8 -LiteralPath $settings
Write-Output 'Ajuste AutoStart escrito.'

if (-not $NoReiniciarDocker) {
    Write-Output 'Encendiendo Docker Desktop...'
    Start-Process -FilePath $exe | Out-Null
    Wait-DockerEngine
}

# 4. Comprobacion: el ajuste sigue puesto y el contenedor vuelve solo.
$verified = (Get-Content -Raw -LiteralPath $settings | ConvertFrom-Json).AutoStart
$approvedNow = (Get-ItemProperty -LiteralPath $approvedKey -Name $entry).$entry
$enabled = ($approvedNow[0] -ne 3)
if ($verified -ne $true -or -not $enabled) {
    throw 'El autoarranque no quedo fijado. Revisalo en Docker Desktop - Settings - General.'
}

docker info --format '{{.ServerVersion}}' 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) {
    $policy = docker inspect $container --format '{{.HostConfig.RestartPolicy.Name}}' 2>$null
    if ($LASTEXITCODE -eq 0 -and $policy -ne 'unless-stopped') {
        throw "El contenedor $container no tiene la politica unless-stopped (tiene '$policy')."
    }
    for ($attempt = 0; $attempt -lt 90; $attempt++) {
        if ((docker inspect $container --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' 2>$null) -eq 'healthy') { break }
        Start-Sleep -Seconds 2
    }
    Write-Output ('Contenedor: ' + (docker inspect $container --format '{{.State.Status}} {{if .State.Health}}({{.State.Health.Status}}){{end}}' 2>$null))
}

Write-Output 'AUTOARRANQUE_HABILITADO'
Write-Output 'Al iniciar sesion en Windows, Docker Desktop enciende el motor y el registro de entradas vuelve solo.'
Write-Output 'Comprobacion final pendiente del usuario: reiniciar el equipo y abrir http://localhost:8080 sin tocar nada.'
