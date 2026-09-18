# Permite entrar a Administración (puerto 8080) desde otras PC de la misma
# red local. El laboratorio facial (8091) nunca se abre: la cámara del kiosco
# exige localhost y abrirlo no serviría de nada, solo ampliaría el riesgo.
#
# La eleccion queda escrita en .env, junto a compose.yaml: docker compose la
# lee sola en cualquier arranque futuro (start.bat, restart.bat, un reinicio
# de Windows), no solo en esta sesion de PowerShell.
[CmdletBinding()]
param(
    # IP de este equipo en la red local. Si se omite, se detecta sola entre
    # las direcciones IPv4 privadas activas; si hay varias, hay que indicarla.
    [string]$Ip
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$esAdministrador = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).
    IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $esAdministrador) {
    throw 'Este paso crea una regla de Firewall de Windows y necesita permisos de administrador. Ejecuta habilitar-acceso-red.bat (pide el permiso solo) o abre PowerShell como administrador.'
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$container = 'registro-de-entradas'
$archivoEnv = Join-Path $projectRoot '.env'

if (-not $Ip) {
    $candidatas = Get-NetIPAddress -AddressFamily IPv4 -PrefixOrigin Dhcp,Manual -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -match '^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)' }
    if (@($candidatas).Count -eq 0) {
        throw 'No se encontro una IP de red local. Conecta el equipo por cable o Wi-Fi, o indica la IP con -Ip.'
    }
    if (@($candidatas).Count -gt 1) {
        Write-Output 'Este equipo tiene varias direcciones de red:'
        $candidatas | ForEach-Object { Write-Output ('  ' + $_.IPAddress + '  (' + $_.InterfaceAlias + ')') }
        throw 'Elige una y vuelve a ejecutar con -Ip <direccion>.'
    }
    $Ip = $candidatas[0].IPAddress
}
$parsedIp = $null
if (-not [Net.IPAddress]::TryParse($Ip, [ref]$parsedIp) -or
    $parsedIp.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) {
    throw "IP invalida: $Ip"
}
$asignada = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -eq $Ip } | Select-Object -First 1
if (-not $asignada) {
    throw "La IP $Ip no pertenece actualmente a este equipo. Revisa ipconfig."
}

Write-Output "Usando la direccion de este equipo: $Ip"

# Regla de Firewall de Windows: solo el puerto 8080, solo en red privada.
$nombreRegla = 'Registro de entradas - Administracion (8080)'
if (Get-NetFirewallRule -DisplayName $nombreRegla -ErrorAction SilentlyContinue) {
    Write-Output 'La regla de firewall ya existia; se deja como estaba.'
} else {
    New-NetFirewallRule -DisplayName $nombreRegla -Direction Inbound -Protocol TCP `
        -LocalPort 8080 -Action Allow -Profile Private | Out-Null
    Write-Output 'Regla de firewall creada: solo puerto 8080, solo redes privadas.'
}

# Se escribe (o reemplaza) LAN_BIND y LAN_ORIGIN en .env, conservando
# cualquier otra variable que ya hubiera.
# Los @() son imprescindibles: sin ellos, filtrar un archivo inexistente
# devuelve $null, y $null += 'texto' crea una cadena en vez de un arreglo, de
# modo que las dos variables terminarian pegadas en una sola linea.
$previas = @(if (Test-Path -LiteralPath $archivoEnv) { Get-Content -LiteralPath $archivoEnv } else { @() })
$lineas = @($previas | Where-Object { $_ -notmatch '^(LAN_BIND|LAN_ORIGIN)=' })
$lineas += "LAN_BIND=0.0.0.0"
$lineas += "LAN_ORIGIN=http://${Ip}:8080"
Set-Content -LiteralPath $archivoEnv -Value $lineas -Encoding ascii

# Se relee lo escrito: un .env mal formado tumba el arranque con un error
# confuso, y es mejor detenerse aqui que dejarlo a medias.
$comprobacion = @(Get-Content -LiteralPath $archivoEnv)
if (-not ($comprobacion -contains 'LAN_BIND=0.0.0.0') -or
    -not ($comprobacion -contains "LAN_ORIGIN=http://${Ip}:8080")) {
    throw "El archivo .env no quedo bien escrito. Contenido: $($comprobacion -join ' | ')"
}

# Recrear justo despues de otra operacion puede chocar con el puerto anterior
# todavia liberandose (TIME_WAIT). Se reintenta en vez de dejar el contenedor
# apagado con un error cripitico.
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
        # Solo se reintenta el choque pasajero de puerto. Cualquier otro fallo
        # se muestra tal cual: repetirlo solo esconderia la causa real.
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

$healthy = $false
for ($attempt = 0; $attempt -lt 60; $attempt++) {
    if ((docker inspect $container --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' 2>$null) -eq 'healthy') { $healthy = $true; break }
    Start-Sleep -Seconds 2
}
if (-not $healthy) { throw 'El contenedor no volvio a healthy. Ejecuta status.bat.' }

Write-Output ''
Write-Output 'ACCESO_DE_RED_HABILITADO'
Write-Output "Desde otra PC de la misma red: http://${Ip}:8080"
Write-Output 'Esa direccion solo sirve para Administracion; la camara del kiosco sigue exigiendo este equipo.'
Write-Output 'Si la IP de este equipo cambia (DHCP), hay que repetir este paso con la IP nueva.'
Write-Output 'Para revertirlo: deshabilitar-acceso-red.ps1'
