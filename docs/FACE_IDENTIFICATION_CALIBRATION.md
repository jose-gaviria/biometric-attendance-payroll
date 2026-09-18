# Calibración facial

La similitud coseno compara dirección de embeddings L2. Un score alto representa proximidad en el espacio del modelo; no expresa certeza ni porcentaje de acierto.

- **Threshold**: mínimo para Top1. Subirlo suele reducir falsos positivos y aumentar falsos negativos.
- **Falso positivo**: desconocido aceptado o registrado asignado a otra persona.
- **Falso negativo**: registrado rechazado pese a captura válida.
- **Top1/Top2**: mejores perfiles distintos; no dos templates del mismo perfil.
- **Ambigüedad**: diferencia Top1−Top2 insuficiente, aun si ambos superan el umbral.

## Herramienta offline

```bash
docker compose exec app node dist/server/scripts/calibrate-face-threshold.js
```

Agrupa por versión compatible, compara pares intraidentidad (genuine) y entre identidades (impostor), reporta min/media/max y búsquedas leave-one-out para top1/top2/margen. No imprime embeddings. Solo sugiere threshold si `min(genuine) > max(impostor) + 0.05`. Sugiere `max(0.50, max(impostor)+0.05)` y margen mínimo 0.08; son heurísticas iniciales. Si falta una segunda persona o se solapan scores, no sugiere configuración automática. No modifica SQLite.

## Prueba presencial independiente

Enrola con consentimiento a José y Mateo. Cierra la sesión de captura y usa otra sesión, luz y pequeñas poses; no uses los mismos frames de enrolamiento para evaluar. Haz al menos 20 intentos por persona y 20 con personas no registradas. Registra en una tabla local: identidad esperada o desconocido, resultado, Top1, Top2, margen, rechazo por calidad/presencia, fecha y configuración.

Comprueba José→José, Mateo→Mateo, José nunca→Mateo, Mateo nunca→José, desconocido→rechazo. Cuenta las muestras de mala calidad y fallos de presencia por separado; no los ocultes para elevar la tasa de éxito. Reporta falsos positivos / intentos impostores y falsos negativos / intentos genuinos, indicando denominadores. Cero fallos con pocos ejemplos no demuestra riesgo cero.

Si hay impostores aceptados, sube threshold/margen y repite una nueva tanda independiente. Si hay rechazos genuinos, mejora luz y enrolamiento antes de bajar umbral. Guarda resultados locales sin fotos y conserva la versión exacta del modelo. Nunca ajustes para forzar que una persona concreta pase ignorando a los demás. La configuración de la UI persiste; `.env` solo define valores iniciales.
