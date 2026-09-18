# Enrolamiento

Seis templates SFace normalizados L2 de 128 floats, en BLOB little-endian de 512 bytes. Nombre de modelo y versión incluyen el prefijo SHA del archivo para no mezclar pesos incompatibles. Solo Express escribe SQLite.

El perfil debe estar activo. La petición de creación exige rol admin, `purpose=enroll`, `profile_id` y consentimiento explícito. Cada intento usa reto aleatorio con TTL. Tras presencia se muestrean frente, izquierda ligera, frente, derecha ligera, frente, frente. Antes de aceptar cada muestra, su instrucción permanece visible al menos 1.2 s; la interfaz indica `MUESTRA N DE 6`. Se exige variación horizontal mayor que 0.09 en coordenadas normalizadas nariz/ojos. Se comprueba continuidad facial durante toda la secuencia, incluyendo después de liveness.

## Calidad

YuNet debe detectar exactamente una cara. Ancho facial mínimo 16% del frame y altura 20%; centro dentro del 25% central por eje, sin bbox recortado. La región facial se redimensiona a 160×160 para medir Laplaciano; varianza mínima 45. Intensidad media permitida 48–215; máximo 35% de píxeles sobre 245. Pose: desplazamiento nariz/ojos absoluto ≤0.65, roll ≤25°, proporción vertical nariz/ojos entre -0.15 y 0.95. Landmarks deben corresponder a una sola cara.

La puntuación heurística de calidad es:

```text
0.35 × min(varianzaLaplaciano / 180, 1)
+ 0.30 × max(0, 1 - abs(luzMedia - 130) / 130)
+ 0.20 × min(proporciónÁrea / 0.16, 1)
+ 0.15 × max(0, 1 - desplazamientoCentro / 0.4)
```

Además de los rechazos individuales, debe superar `FACE_MIN_QUALITY`. No es una métrica universal. Debe ajustarse al equipo tras medir falsos rechazos, conservando detección, seguridad y presencia.

## Confirmación transaccional

Se vuelve a leer la galería completa dentro de la transacción, incluidos perfiles inactivos. Si cualquier muestra nueva supera el umbral de duplicado contra cualquier template compatible de otro perfil, se bloquea y registra la acción. Reactivar un perfil también repite esta comprobación contra perfiles activos para impedir que reaparezca un duplicado. No se asigna a ese otro perfil. Si el perfil cambió durante la captura, el intento se rechaza. Solo al pasar todo se reemplazan templates y se registra `consent_at`. No se borran previamente los anteriores.

Un cambio incompatible de modelo exige reenrolar. Los templates incompatibles no participan en búsqueda ni en detección de duplicados; la interfaz marca actualización. Antes de cambiar modelo hay que revalidar toda la galería para restablecer la cobertura de duplicados.
