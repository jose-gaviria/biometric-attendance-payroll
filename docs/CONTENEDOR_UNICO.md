# Operación en un solo contenedor

En Docker Desktop, el grupo `registro-de-entradas` contiene únicamente **registro-de-entradas**. Encender ese contenedor inicia Turnos, el laboratorio facial y el motor de reconocimiento. No requiere otros contenedores, carpetas del escritorio, Node/Python instalados en Windows ni conexión a Internet.

- Aplicación completa: http://localhost:8080.
- Laboratorio y configuración facial: http://localhost:8091.
- Imagen autocontenida: `biometric-attendance-payroll:1.0.0`.
- Almacenamiento persistente de Docker: volumen `biometric-attendance-payroll-data`, conectado en `/data`.

La cámara y Docker Desktop deben estar disponibles. Espera a que Docker muestre `healthy` después de arrancar; los modelos se cargan durante ese inicio.

## Datos

| Contenido | Ruta dentro del contenedor |
|---|---|
| Trabajadores, turnos, liquidaciones y vínculos faciales | `/data/turnos/attendance-payroll.sqlite` |
| Perfiles, templates, consentimiento, administrador facial y ajustes | `/data/face/face-lab.sqlite` |
| Configuración privada de Turnos y canal interno | `/data/config/` |
| Respaldos SQLite de ambas bases | `/data/backups/` |

El volumen es almacenamiento administrado por Docker, no otro servicio ni una carpeta de Windows montada. Sobrevive a detener y recrear el contenedor. Está declarado externo en Compose para que `docker compose down -v` no lo elimine. Eliminar ese volumen directamente desde Docker sí elimina los datos activos.

Las carpetas `runtime/data` anteriores son respaldos históricos; la aplicación no las lee ni escribe. La instalación activa de desarrollo contiene datos ficticios para exposición; no forman parte del portable. No hay rostros, templates ni clave administrativa precargada: quien entra por primera vez define la clave. El `.env` actual solo controla el acceso opcional por red.

## Datos demo de este equipo

`scripts/seed-demo-data.mjs` carga siete trabajadores ficticios (seis activos y uno inactivo), cinco semanas de horarios, jornadas con las ocho categorías de hora, bonificaciones, deducciones, dos liquidaciones y un turno abierto. Se niega a ejecutarse si encuentra datos de uso o perfiles faciales. Los PIN demo son `4101` a `4107`, siguiendo el código `DEMO-001` a `DEMO-007`. `DEMO-001` está preparado para mostrar enrolamiento facial en vivo; la biometría no se falsifica ni se precarga.

## Encender, apagar y respaldar

Desde Docker Desktop basta con Start/Stop de `registro-de-entradas`. Los archivos `start.bat`, `stop.bat`, `restart.bat`, `backup.bat` e `iniciar-integrado.bat` son accesos opcionales. Los comandos equivalentes son:

```text
docker start registro-de-entradas
docker stop --timeout 45 registro-de-entradas
docker restart --timeout 45 registro-de-entradas
docker exec registro-de-entradas python /opt/unified/backup.py
docker exec registro-de-entradas python /opt/unified/health.py
```

El supervisor valida ambas bases antes de iniciar, crea respaldos al arrancar y cada 24 horas, vigila los tres procesos y vuelve a iniciar un proceso que termina inesperadamente. Tres comprobaciones de salud fallidas consecutivas después del periodo inicial también provocan recuperación. Los fallos repetidos hacen salir al supervisor para que Docker reinicie el conjunto. Detener manualmente el contenedor se respeta.

No es posible garantizar ausencia absoluta de fallos. Los respaldos dentro del mismo Docker no protegen contra pérdida del disco completo. Se conserva adicionalmente el respaldo privado de migración en `runtime/unified-migration/20260909T184021Z/`; incluye configuración privada y datos reales, no debe publicarse.

## Recuperación

Si solo se eliminó el contenedor, conserva el volumen y ejecuta `docker compose up -d --no-build --pull never` desde este proyecto para recrearlo. No necesita las imágenes de los tres servicios antiguos: la imagen unificada contiene todo su runtime.

La recuperación de una base desde respaldo debe hacerse con el contenedor detenido, conservando antes la base actual y sus WAL/SHM. No mezclar un respaldo con un WAL anterior. Los vínculos entre empleados y perfiles exigen conservar ambas bases. Para restaurar el archivo privado de migración completo, importa `private-data.tar` con `/opt/unified/import_data.py` en un volumen nuevo y vacío; el importador rechaza sobrescribir datos. Elige explícitamente ese volumen al recrear el contenedor. No restaurar sobre el volumen activo.

## Desarrollo y distribución

`Dockerfile.unified` construye laboratorio, Turnos y motor facial desde las fuentes del mismo repositorio. `turnos-app/` contiene el módulo antes alojado en la carpeta vecina; ya no se necesita `attendance-payroll:local` ni ningún otro artefacto previo para reconstruir. El resultado conserva dos ejecutables Node para que cada módulo nativo SQLite use la versión con que fue compilado.

El despliegue anterior de tres contenedores fue retirado: la instalación vigente es un solo contenedor.

`export-offline.bat` genera un ZIP en `runtime/portable` con la imagen `biometric-attendance-payroll:1.0.0`, Compose, instalador, operación y hashes SHA-256. El formato vigente no incluye el volumen ni ningún dato privado. En otro Windows x64 con Docker Desktop, se extrae y ejecuta `install-offline.bat`; no requiere repositorio, compilación, Internet, Node ni Python del host. El instalador crea un volumen vacío y el usuario define la clave desde el primer acceso.

Si la instalación falla antes de quedar sana, el instalador retira el contenedor y volumen parciales para permitir un segundo intento limpio. Una instalación ya verificada se conserva aunque falle la configuración posterior del autoarranque.

## Evidencia de verificación

- `scripts/test-unified.py`: instalación desechable sin red (`--network none`) ni carpetas montadas. La muestra facial pública vive en `tests/fixtures/`, por lo que el verificador tampoco descarga nada. Inferencia real, cuatro capturas frontales, entrada/salida con rostro y PIN, consentimiento obligatorio y reto activo de enrolamiento, resultado idempotente.
- Interrupción forzada y recuperación de los tres procesos internos, Stop/Start y recreación completa conservando el mismo volumen.
- Imagen reconstruida únicamente desde este repositorio; 51 pruebas del laboratorio, 14 pruebas específicas de integración facial de Turnos, lint, tipos, builds y auditorías npm de la construcción sin vulnerabilidades de producción conocidas.
- Flujos desechables de horarios, bonificaciones, borrado de trabajador/rostro, retención histórica, PDF, clave y acceso LAN administrativo aprobados.
- Instalación activa: tres servicios saludables, cero reinicios y bases íntegras; actualmente contiene solo los datos ficticios de exposición descritos arriba.

La auditoría laboral vigente está en `docs/AUDITORIA_NOMINA_COLOMBIA_2026.md` y su prueba HTTP aislada en `scripts/test-payroll-legal.py`.

No se generaron marcaciones reales durante estas pruebas. La prueba de reconocimiento automatizada usa un fixture preparado en la base desechable; no constituye una evaluación de precisión para todos los trabajadores ni una prueba presencial de enrolamiento.

## Direcciones válidas

Tanto `http://localhost:8080` como `http://127.0.0.1:8080` funcionan, y lo mismo en el 8091. Ambas son el mismo equipo y el navegador las trata como origen seguro, de modo que la cámara puede pedirse en las dos. Cualquier otro origen sigue rechazado. Si Chrome pregunta por la cámara en una de esas direcciones, hay que pulsar Permitir una vez por dirección.

## Autoarranque de Windows

Docker Desktop está configurado para **no** abrirse al iniciar sesión. Después de reiniciar el PC hay que abrir Docker Desktop; a partir de ahí `registro-de-entradas` vuelve solo por su política `unless-stopped`. Mientras el motor de Docker esté apagado, ningún contenedor puede reiniciarse. Para cambiarlo: Docker Desktop → Settings → General → «Start Docker Desktop when you sign in», y comprobar que la entrada Docker Desktop esté habilitada en Administrador de tareas → Inicio.
