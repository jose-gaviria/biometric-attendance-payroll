# Empaqueta la aplicacion para instalarla en otro equipo. El paquete NO lleva
# datos: la instalacion se crea vacia en el destino y la clave la define quien
# instala, de modo que este ZIP no contiene biometria ni contrasenas de nadie.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $PSScriptRoot
$portableRoot = Join-Path $projectRoot 'runtime\portable'
$stageRoot = Join-Path $portableRoot 'stage'
$bundleRoot = Join-Path $stageRoot 'registro-de-entradas'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$zipPath = Join-Path $portableRoot "registro-de-entradas-$stamp.zip"
$image = 'biometric-attendance-payroll:1.0.0'
$container = 'registro-de-entradas'
$volume = 'biometric-attendance-payroll-data'

function Invoke-Docker([string[]]$Arguments) {
    & docker @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Docker no completo: $($Arguments -join ' ')" }
}

docker info --format '{{.ServerVersion}}' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Inicia Docker Desktop antes de exportar.' }
$null = Invoke-Docker @('image','inspect',$image)

New-Item -ItemType Directory -Force -Path $portableRoot | Out-Null
$resolvedPortable = [IO.Path]::GetFullPath($portableRoot)
$resolvedStage = [IO.Path]::GetFullPath($stageRoot)
if (-not $resolvedStage.StartsWith($resolvedPortable + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Carpeta temporal invalida.' }
if (Test-Path -LiteralPath $stageRoot) { Remove-Item -LiteralPath $stageRoot -Recurse -Force }
New-Item -ItemType Directory -Force -Path (Join-Path $bundleRoot 'scripts') | Out-Null

Write-Output '1/4 Exportando la imagen completa de Docker...'
Invoke-Docker @('save',$image,'-o',(Join-Path $bundleRoot 'image.tar'))

Write-Output '2/4 Preparando instalador y manifiesto...'
Copy-Item -LiteralPath (Join-Path $projectRoot 'portable\compose.yaml') -Destination $bundleRoot
Copy-Item -LiteralPath (Join-Path $projectRoot 'portable\README.md') -Destination $bundleRoot
Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts\install-offline.ps1') -Destination (Join-Path $bundleRoot 'scripts')
Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts\enable-autostart.ps1') -Destination (Join-Path $bundleRoot 'scripts')
foreach ($file in @('install-offline.bat','habilitar-autoarranque.bat','habilitar-acceso-red.bat','deshabilitar-acceso-red.bat','start.bat','stop.bat','restart.bat','backup.bat','status.bat','configurar-admin.bat')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination $bundleRoot
}
Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts\habilitar-acceso-red.ps1') -Destination (Join-Path $bundleRoot 'scripts')
Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts\deshabilitar-acceso-red.ps1') -Destination (Join-Path $bundleRoot 'scripts')
$manifest = [ordered]@{
    format = 2
    created_at_utc = [DateTime]::UtcNow.ToString('o')
    image = $image
    container = $container
    volume = $volume
    includes_private_data = $false
}
$manifest | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 -LiteralPath (Join-Path $bundleRoot 'MANIFEST.json')

Write-Output '3/4 Calculando integridad de todos los archivos...'
$hashes = [ordered]@{}
Get-ChildItem -LiteralPath $bundleRoot -File -Recurse | Sort-Object FullName | ForEach-Object {
    $relative = $_.FullName.Substring($bundleRoot.Length).TrimStart('\').Replace('\','/')
    $hashes[$relative] = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant()
}
$hashes | ConvertTo-Json | Set-Content -Encoding utf8 -LiteralPath (Join-Path $bundleRoot 'SHA256.json')

Write-Output '4/4 Comprimiendo el paquete...'
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($bundleRoot, $zipPath, [IO.Compression.CompressionLevel]::Optimal, $false)
$zipHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $zipPath).Hash.ToLowerInvariant()
Set-Content -Encoding ascii -LiteralPath ($zipPath + '.sha256') -Value "$zipHash  $([IO.Path]::GetFileName($zipPath))"
Remove-Item -LiteralPath $stageRoot -Recurse -Force
Write-Output "PAQUETE_LISTO=$zipPath"
Write-Output "SHA256=$zipHash"
