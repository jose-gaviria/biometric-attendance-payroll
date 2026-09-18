# Distribución offline para Windows

## Crear el paquete

Con Docker Desktop encendido y la imagen `biometric-attendance-payroll:1.0.0` ya verificada, ejecuta `export-offline.bat`. El resultado queda en `runtime/portable/` como un ZIP y una huella `.sha256`.

El formato vigente es una instalación limpia. Incluye:

- la única imagen Docker necesaria para ejecutar;
- `compose.yaml`;
- instalador y accesos de operación;
- manifiesto y hashes de cada archivo.

No incluye SQLite, trabajadores, rostros, liquidaciones, claves, respaldos ni el código fuente. `MANIFEST.json` declara `includes_private_data: false`.

## Instalar sin Internet

El Windows de destino debe tener Docker Desktop instalado y abierto. Extrae el ZIP completo y ejecuta `install-offline.bat`.

El instalador:

1. verifica todos los hashes y las rutas del manifiesto;
2. rechaza sobrescribir un contenedor o volumen existente;
3. carga la imagen desde `image.tar`;
4. crea el volumen y ambas SQLite vacías sin red;
5. inicia el contenedor sin build ni pull;
6. espera salud de los tres procesos y confirma que no haya datos personales;
7. configura el autoarranque, salvo que se invoque con `-SinAutoarranque`.

Si falla antes de terminar la comprobación, retira el contenedor y el volumen parciales. Después de `INSTALACION_COMPLETA`, abre `http://localhost:8080`, pulsa Administración y define la clave. No hay una clave incluida en el paquete.

No hacen falta Node, Python, npm, pip, modelos ni conexión a Internet en el equipo de destino.

## Aislamiento comprobado

Los modelos, paquetes, JS, CSS y fuentes están dentro de la imagen. `scripts/test-portable-install.ps1` extrae el ZIP, instala con nombres Docker desechables, valida salud y datos vacíos, define la clave, entra, crea un trabajador y comprueba horarios, kiosco y canal facial. `scripts/test-unified.py` ejecuta además el flujo facial con `--network none` y sin carpetas del host montadas.

La cámara sigue siendo un dispositivo del navegador de Windows. La aceptación física final debe probarse en el PC de producción con la red desconectada, Docker activo y permisos de cámara concedidos a `http://localhost:8080`.

## Operación

Usa `start.bat`, `stop.bat`, `restart.bat`, `status.bat` y `backup.bat`. `habilitar-acceso-red.bat` publica únicamente Administración en el puerto 8080 de la red privada; las marcaciones remotas y el puerto facial 8091 permanecen bloqueados.
