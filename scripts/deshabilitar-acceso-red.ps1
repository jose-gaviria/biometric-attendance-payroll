# Vuelve Administración a solo-este-equipo: quita LAN_BIND/LAN_ORIGIN de
# .env, recrea el contenedor con los puertos por defecto y retira la regla
# de firewall que habia abierto habilitar-acceso-red.ps1.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$esAdministrador = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).
    IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $esAdministrador) {
    throw 'Retirar la regla de Firewall necesita permisos de administrador. Ejecuta deshabilitar-acceso-red.bat (pide el permiso solo) o abre PowerShell como administrador.'
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$container = 'registro-de-entradas'
$archivoEnv = Join-Path $projectRoot '.env'
$nombreRegla = 'Registro de entradas - Administracion (8080)'

if (Test-Path -LiteralPath $archivoEnv) {
    # El @() evita que quedarse con una sola linea la convierta en cadena suelta.
    $lineas = @(Get-Content -LiteralPath $archivoEnv | Where-Object { $_ -notmatch '^(LAN_BIND|LAN_ORIGIN)=' })
    if ($lineas.Count -eq 0) {
        Remove-Item -LiteralPath $archivoEnv -Force
    } else {
        Set-Content -LiteralPath $archivoEnv -Value $lineas -Encoding ascii
    }
}

# Igual que al habilitar: el puerto anterior puede seguir liberandose.
Push-Location $projectRoot
try {
    $recreado = $false
    for ($intento = 1; $intento -le 5; $intento++) {
        # Docker escribe su progreso normal por la salida de error. En
        # PowerShell 5.1 eso aborta el guion aunque todo vaya bien, asi que se
        # baja la severidad solo aqui y se juzga por el codigo de salida.
        # La redireccion la hace cmd, no PowerShell: asi su salida de error
        # nunca entra al canal de errores de PowerShell, que en la version 5.1
        # la trataria como fallo y llenaria la pantalla de rojo.
        $registro = [IO.Path]::GetTempFileName()
        & cmd /c "docker compose up -d --no-build > `"$registro`" 2>&1"
        $salida = @(Get-Content -LiteralPath $registro -ErrorAction SilentlyContinue)
        Remove-Item -LiteralPath $registro -Force -ErrorAction SilentlyContinue
        $salida | ForEach-Object { Write-Output $_ }
        if ($LASTEXITCODE -eq 0) { $recreado = $true; break }
        $esPuertoOcupado = ($salida -join ' ') -match 'ports are not available|address already in use|Solo se permite un uso'
        if (-not $esPuertoOcupado) {
            throw 'No se pudo recrear el contenedor. Revisa el mensaje de Docker de arriba.'
        }
        if ($intento -lt 5) {
            Write-Output "El puerto todavia estaba ocupado; reintentando ($intento de 4)..."
            Start-Sleep -Seconds 6
        }
    }
    if (-not $recreado) { throw 'El puerto 8080 siguio ocupado tras varios intentos.' }
} finally {
    Pop-Location
}

if (Get-NetFirewallRule -DisplayName $nombreRegla -ErrorAction SilentlyContinue) {
    Remove-NetFirewallRule -DisplayName $nombreRegla
    Write-Output 'Regla de firewall retirada.'
}

$healthy = $false
for ($attempt = 0; $attempt -lt 60; $attempt++) {
    if ((docker inspect $container --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' 2>$null) -eq 'healthy') { $healthy = $true; break }
    Start-Sleep -Seconds 2
}
if (-not $healthy) { throw 'El contenedor no volvio a healthy. Ejecuta status.bat.' }

Write-Output 'ACCESO_DE_RED_DESHABILITADO'
Write-Output 'Administracion vuelve a responder solo en este equipo (127.0.0.1:8080).'
