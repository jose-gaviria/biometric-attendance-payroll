# Identificación frontal automática — 2026-09-09

Tras validar el enrolamiento y el reconocimiento, se pidió que una persona ya enrolada solo tenga que poner el rostro frente a la cámara; los pasos activos se conservan en enrolamiento.

Esta instrucción sustituye el requisito inicial de retos activos durante identificación. Enrolar/actualizar exige consentimiento, parpadeo o giro y seis muestras. Identificar exige una sola cara, calidad, pose frontal, continuidad, cuatro muestras y matching 1:N con threshold/margen; no pide parpadeos ni giros. Los intentos siguen teniendo sesión, nonce, TTL, control de concurrencia y consumo único. La API decide el modo según propósito, no según una bandera del navegador.

La identificación frontal **no verifica liveness activo ni liveness pasivo anti-spoofing**. Los logs guardan `liveness_passed=0`. No se interpreta la mera variación entre JPEG como prueba de una persona viva. La protección frente a fotos/videos es inferior a la del reto activo; es una consecuencia explícita de la interacción solicitada, no un control que se declare aprobado.

La migración 2 es aditiva: añade `capture_mode` a los intentos. No modifica ni borra perfiles, templates ni configuración. `type` conserva el esquema histórico de reto aleatorio; en modo frontal se ignora. Los intentos anteriores quedan invalidados al reiniciar el proceso. Los modelos no cambian, por lo que no hace falta reenrolar.

## Confirmación de marcación y PIN tras tres fallos — 2026-09-11

Al recibir una marcación facial confirmada por Turnos, la cámara se detiene y se desmonta inmediatamente. La interfaz muestra durante cinco segundos una tarjeta de “Entrada registrada” o “Salida registrada”, con el nombre y la hora, y luego vuelve sola al kiosco.

El kiosco muestra inicialmente solo las acciones faciales. La lista de trabajadores y el formulario de PIN se habilitan cuando tres intentos completos de reconocimiento fallan para la misma sesión y acción. La regla se valida también en el servidor: ocultar o alterar la interfaz no permite saltarla. Cada intento tiene un identificador de un uso y caduca a los diez minutos; repetir fotogramas o reportar dos veces el mismo error no aumenta el contador. Cancelar, cerrar la cámara y los errores de jornada después de identificar correctamente no cuentan como fallos. Una marcación facial o por PIN cierra todos los intentos de la sesión y vuelve a bloquear el PIN.

Los errores físicos de cámara son comunicados por el navegador mediante un intento previamente emitido y ligado a la sesión. El servidor limita cada reporte a un único fallo, aunque no puede demostrar criptográficamente que el dispositivo físico esté averiado.
