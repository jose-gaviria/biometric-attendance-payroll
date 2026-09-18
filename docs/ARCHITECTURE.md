# Arquitectura y decisión vigente — 2026-09-09

Aplicación integrada con Turnos para personas que aceptan expresamente el registro facial. React + TypeScript + Vite genera archivos estáticos servidos por Express. El laboratorio Express conserva la autoridad sobre perfiles, sesiones, retos, consentimiento, matching y su SQLite; Turnos conserva trabajadores, jornadas, liquidaciones y vínculos en su propia SQLite. Python FastAPI procesa JPEG efímeros mediante YuNet, SFace y MediaPipe Face Landmarker CPU.

Por petición explícita posterior, el despliegue vigente es un solo contenedor `registro-de-entradas`: tres procesos supervisados, comunicación por loopback, modelos incluidos y volumen persistente Docker para ambas bases y configuración privada. Publica 127.0.0.1:8080 para Turnos y 127.0.0.1:8091 para el laboratorio; opcionalmente publica 8080 en la red privada solo para Administración. No monta carpetas del host ni requiere otros contenedores o hosting externo. Operación y evidencia actual en `CONTENEDOR_UNICO.md`; las menciones restantes al laboratorio describen su módulo lógico, no un contenedor independiente.

Se eligió SQLite + caché en memoria frente a una base vectorial: cientos de perfiles no justifican otro servicio. Se eligió media de los dos mejores templates por perfil, consolidada por mediana entre cuatro consultas, frente al máximo de un template (sensible a outliers) o un centroide único (pierde variaciones de pose). Es una decisión de ingeniería que requiere calibración local, no una recomendación universal de SFace. Además, todos los frames deben coincidir en candidato y superar el umbral. Solo se comparan versiones idénticas.

## G1: activos y amenazas

Los embeddings son el dato más sensible. Solo Node y SQLite los reciben; nunca el navegador. El administrador tiene acceso a gestión y calibración. El kiosco es una sesión autenticada con rol limitado: puede identificar, pero no gestionar perfiles ni leer candidatos/scores. Primer administrador: se crea mediante CLI interactivo dentro del contenedor, sin contraseña predeterminada ni endpoint público de configuración.

Fronteras: navegador → API (sesión, origen exacto, esquema estricto, límites); API → Python (red privada, respuestas verificadas); API → SQLite (parámetros y transacciones). El dueño del equipo y quien controla Docker pueden leer el volumen; el cifrado de disco de Windows y acceso al equipo son la frontera de almacenamiento. No se promete cifrado biométrico en reposo.

Abusos: un sitio externo intenta enviar frames (Origin y Fetch Metadata); una sesión de kiosco intenta eliminar un perfil (rol servidor); repetir un reto (consumo atómico, expiración y nonce); cambiar de persona durante el reto (continuidad de embeddings); registrar una persona en dos perfiles (comparación dentro de transacción al guardar); agotar CPU (límites, una petición por reto, un worker de inferencia y timeout); subir imagen descomprimida gigante (cabecera JPEG y dimensiones comprobadas antes de decodificar).

## G2: persistencia y autorización

Un solo proceso Node y un solo worker Python. SQLite WAL, foreign_keys, secure_delete y migraciones por user_version; datos de una instalación local, sin multiinquilino. Todos los endpoints salvo /health y login requieren sesión. Sesiones aleatorias de 256 bits, hash en SQLite, cookie HttpOnly SameSite=Strict y expiración. Password bcrypt coste 12. Sin JWT con permisos congelados. No aplica RLS ni webhooks. No guardar cuerpos, imágenes, contraseñas ni embeddings en logs. Logs de identificaciones se conservan 30 días; borrar un perfil elimina sus registros identificables. Backups se administran por separado y contienen biometría.

## Máquina de estados

Un reto queda ligado a sesión, propósito, perfil (enrolamiento), nonce y TTL. En enrolamiento empieza con frame frontal, exige transición aleatoria, vuelve al frente y recoge 6 muestras. En identificación recoge automáticamente 4 muestras frontales, sin retos activos, según la petición posterior del usuario (ver IDENTIFICATION_UX_CHANGE.md). Cada frame se recibe/procesa secuencialmente: ningún booleano enviado por el cliente acredita presencia. En identificación frontal no se declara liveness aprobado. Las muestras y el estado de presencia existen en memoria con vencimiento. Un reinicio invalida los retos pendientes sin perder perfiles. Cancelar libera memoria. Al completar, se consume el reto atómicamente antes de confirmar cambios.

## Privacidad y límites

Consentimiento explícito antes de cada enrolamiento. Sin fotos/videos persistentes. El borrado biométrico elimina filas de templates; el mantenimiento hace checkpoint/truncate del WAL. Los backups antiguos deben eliminarse o rotarse por el responsable. No usar para decisiones de acceso de alta seguridad: liveness geométrico básico no certifica resistencia a replay, inyección de cámara o deepfake. La precisión debe medirse con voluntarios reales; los tests numéricos no la prueban.
