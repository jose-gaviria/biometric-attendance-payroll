# Presencia activa básica en enrolamiento

Esta validación se realiza al enrolar/actualizar. La identificación es frontal automática y no declara presencia viva, según IDENTIFICATION_UX_CHANGE.md.

Express elige aleatoriamente `blink`, `left` o `right`, con UUID, nonce aleatorio 256 bits, sesión, propósito, perfil opcional, creación, vencimiento y bandera de uso. El TTL es de 45 segundos para que la persona pueda seguir las instrucciones sin apresurarse. Una sesión tiene un intento vigente; el estado de observaciones existe en memoria y el contrato del reto en SQLite. Reiniciar invalida los intentos abiertos.

Cada frame JPEG se envía secuencialmente a Python. MediaPipe Face Landmarker calcula geometría real; el frontend no puede aprobar presencia. Cada JPEG debe ser distinto. La continuidad temporal deriva del umbral de reconocimiento con un piso de 0.34 y un techo de 0.50 para tolerar gafas, reflejos y movimiento; la decisión final de identidad conserva su umbral y margen configurados. Cambio de persona o pérdida/multiplicidad de caras tras iniciar la transición invalida la secuencia. Se comprueba vencimiento antes y después de inferencia.

La interfaz presenta tres pasos numerados. Exige al menos cuatro frames frontales durante 600 ms y, antes de evaluar la acción, mantiene su instrucción visible durante 1.4 s. La instrucción de regreso se mantiene 1.2 s y la confirmación de presencia otros 1.2 s. Los avisos de calidad no pueden reemplazarse más de una vez cada 1.2 s.

## Parpadeo

EAR bilateral: suma de dos distancias verticales del ojo dividida entre dos veces su anchura. Se requieren cuatro frames iniciales con ojos abiertos (EAR >0.20) y pose frontal. Se exigen dos frames de cierre menor que `min(0.17, 0.65 × EAR inicial)` y después tres frames abiertos sobre el 80% del valor inicial. Ojos cerrados desde el principio o una imagen repetida no pasan.

## Giros

La nariz se proyecta sobre el eje de los ojos y se divide por distancia interocular. Se toman cuatro frames frontales como base; luego tres frames con delta >0.18 (izquierda del participante) o <-0.18 (derecha), y tres de regreso dentro de ±0.12 del origen. La vista se refleja como un espejo; los datos enviados no se reflejan. La orientación debe verificarse presencialmente.

## Límites

Es challenge-response geométrico básico, no detección de presentación certificada. El nonce impide volver a consumir una sesión, **no autentica el origen físico de cada píxel**. Una cámara virtual o cliente alterado puede inyectar un video adaptable. Una foto inclinada/movida o pantalla puede explotar estimación geométrica; se requiere prueba empírica y no se promete bloqueo total. El sistema no debe emplearse como autenticador bancario ni único control de acceso sensible.

Los tests de Node verifican las transiciones, uso único y expiración con trazas numéricas. Los tests Python verifican landmarks reales. Ninguno sustituye medir parpadeos/giros reales ni ataques de presentación con la webcam objetivo.
