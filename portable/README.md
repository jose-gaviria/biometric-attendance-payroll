# Registro de entradas — Biometric Attendance & Payroll

Paquete de instalación. Contiene la aplicación completa: turnos, nómina, reconocimiento facial y sus modelos.

**No contiene datos de nadie.** Ni trabajadores, ni rostros, ni liquidaciones, ni contraseñas. La instalación nace vacía en este equipo y la clave de administración la defines tú la primera vez que entras al panel.

## Instalar

1. Instala y abre **Docker Desktop**. Espera a que diga *Engine running*.
2. Extrae el ZIP completo a una carpeta fija, por ejemplo `C:\registro-de-entradas`.
3. Ejecuta `install-offline.bat`.
4. Espera a `INSTALACION_COMPLETA`.
5. Abre `http://localhost:8080` y pulsa **Administración**: la primera vez te pedirá **definir la clave** del panel. Mínimo 10 caracteres. **Apúntala: no hay forma de recuperarla.**

Después puedes cambiarla desde **Cambiar clave**, en la barra lateral del panel; te pedirá la actual antes de aceptar la nueva.

El instalador comprueba archivo por archivo que el paquete llegó completo, se niega a pisar una instalación existente y verifica al final que los tres servicios respondan y que la instalación quede vacía. También deja el equipo encendiendo el sistema solo al iniciar sesión en Windows.

No necesita Internet, ni Node, ni Python, ni el repositorio, ni otros contenedores.

**Requisitos:** Windows 64 bits, Docker Desktop, cámara web y unos 8 GB libres. Los puertos 8080 y 8091 deben estar libres.

## Que encienda solo con el PC

Lo hace el instalador. Para repetirlo o comprobarlo: `habilitar-autoarranque.bat`. Después reinicia el equipo una vez y comprueba que `http://localhost:8080` responda sin tocar nada.

## Uso diario

| Para | Archivo |
|---|---|
| Encender | `start.bat` |
| Apagar | `stop.bat` |
| Reiniciar | `restart.bat` |
| Ver estado | `status.bat` |
| Respaldo manual | `backup.bat` |
| Administrador del laboratorio facial | `configurar-admin.bat` |

También puedes encender y apagar desde Docker Desktop: el contenedor se llama `registro-de-entradas`.

## Direcciones

- Aplicación completa: `http://localhost:8080`
- Laboratorio facial: `http://localhost:8091`

Nada sale del equipo.

Para abrir únicamente Administración a otras PC de la red privada, ejecuta
`habilitar-acceso-red.bat` una vez. El servidor mantiene bloqueados el kiosco y
las marcaciones remotas; el laboratorio 8091 nunca se publica. Para revertirlo,
ejecuta `deshabilitar-acceso-red.bat`.

## Datos y respaldos

Todo vive en el volumen de Docker `biometric-attendance-payroll-data`. El sistema respalda ambas bases al arrancar y cada 24 horas dentro de ese mismo volumen: eso protege de un fallo de la aplicación, **no** de la pérdida del disco. Copia el volumen a otro medio de vez en cuando.

Las liquidaciones guardadas se borran solas a los dos meses. Descarga su PDF o su CSV antes.
