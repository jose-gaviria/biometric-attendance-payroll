# Identificación 1:N

No se selecciona perfil. Se valida rostro único, calidad, continuidad y cuatro muestras frontales, sin pedir giros ni parpadeos (petición posterior del usuario; ver IDENTIFICATION_UX_CHANGE.md). La continuidad usa un umbral derivado del de reconocimiento, limitado entre 0.48 y 0.65. YuNet produce bbox y cinco landmarks, `alignCrop` alinea el rostro, SFace extrae 128 componentes y se normalizan L2. Ningún vector sale al navegador.

Para cada consulta y perfil se calcula la media de los dos templates más similares (o el único si una base migrada solo tiene uno). El score final del perfil es la mediana de sus cuatro scores de consulta. Se ordenan perfiles distintos, no templates. Se acepta solo si:

1. Top1 ≥ threshold.
2. Si existe Top2, Top1 − Top2 ≥ ambiguity margin.
3. Cada una de las cuatro consultas elige el mismo perfil y supera individualmente threshold y margen.

No hay segundo candidato si existe un único perfil: no se inventa score para Top2, se aplica el umbral absoluto. Galería vacía o score insuficiente devuelve desconocido; margen corto devuelve ambiguo; inconsistencia entre frames rechaza. La similitud coseno de vectores L2 es el producto punto, no un porcentaje ni una probabilidad de identidad.

El rostro no identificado no se guarda como perfil ni se añade automáticamente a la galería. Logs contienen scores, resultado, motivo, presencia y fecha; solo admin puede consultarlos. La UI normal recibe nombre únicamente si hubo aceptación. Cuatro muestras no garantizan que una persona desconocida jamás produzca falso positivo.

La configuración original 0.50/0.08 es un punto de partida conservador frente al ejemplo 1:1 de OpenCV (0.363); aquel benchmark no equivale a validación 1:N ni a una recomendación para esta población. La API impide bajar coincidencia de 0.45, margen de 0.05 o calidad de 0.50, y limita la relación entre coincidencia y duplicados para evitar que una edición accidental anule las protecciones. [Fuente oficial de SFace/OpenCV](https://docs.opencv.org/4.x/d0/dd4/tutorial_dnn_face.html), consultada 2026-09-09.
