# Third-party notices

Verificado el 2026-09-09 contra metadatos npm/PyPI y repositorios oficiales. Las versiones están fijadas; los avisos transitivos y sus textos se conservan en los paquetes distribuidos. Véase `licenses/` y `face-service/models/manifest.json` para licencias y hashes íntegros de modelos.

| Nombre | Versión | Fuente | Licencia | Uso |
|---|---|---|---|---|
| React / React DOM | 19.2.8 | https://github.com/facebook/react | MIT | Interfaz |
| Vite | 8.2.2 | https://github.com/vitejs/vite | MIT | Build estático |
| TypeScript | 6.0.3 | https://github.com/microsoft/TypeScript | Apache-2.0 | Tipos y compilación |
| Express | 5.2.1 | https://github.com/expressjs/express | MIT | API |
| better-sqlite3 | 13.0.3 | https://github.com/WiseLibs/better-sqlite3 | MIT | SQLite local |
| SQLite | versión incluida en better-sqlite3 | https://sqlite.org/copyright.html | Dominio público | Base local |
| bcryptjs | 3.0.3 | https://github.com/dcodeIO/bcrypt.js | BSD-3-Clause | Contraseñas |
| Zod | 4.5.4 | https://github.com/colinhacks/zod | MIT | Validación |
| Helmet | 8.3.0 | https://github.com/helmetjs/helmet | MIT | Cabeceras |
| express-rate-limit | 8.7.0 | https://github.com/express-rate-limit/express-rate-limit | MIT | Límites API |
| FastAPI | 0.141.1 | https://github.com/fastapi/fastapi | MIT | Inferencia HTTP |
| Uvicorn | 0.52.4 | https://github.com/encode/uvicorn | BSD-3-Clause | Servidor ASGI |
| OpenCV contrib Python | 4.13.0.92 | https://github.com/opencv/opencv-python | Apache-2.0 y avisos incluidos | Detección/alineación/inferencia CPU |
| MediaPipe | 0.10.32 | https://github.com/google-ai-edge/mediapipe | Apache-2.0 | Landmarks locales |
| NumPy | 2.4.3 | https://github.com/numpy/numpy | BSD-3-Clause y licencias de componentes incluidas | Vectores |
| Pillow | 12.3.0 | https://github.com/python-pillow/Pillow | MIT-CMU | Verificar JPEG antes de decodificar |
| Node.js | 24, digest Docker fijado al distribuir | https://github.com/nodejs/node | MIT y avisos de componentes | Runtime |
| Python | 3.12, digest Docker fijado al distribuir | https://www.python.org/psf/license/ | PSF-2.0 y avisos de componentes | Runtime |
| ESLint / TypeScript ESLint / tsx / @types | package-lock.json | https://www.npmjs.com/ | MIT | Desarrollo; no se instalan en runtime |

## Modelos

| Modelo | Versión | Archivo | Fuente/licencia |
|---|---|---|---|
| YuNet | 2023mar | face_detection_yunet_2023mar.onnx | [OpenCV Zoo](https://github.com/opencv/opencv_zoo/tree/47534e27c9851bb1128ccc0102f1145e27f23f98/models/face_detection_yunet), MIT |
| SFace | 2021dec | face_recognition_sface_2021dec.onnx | [OpenCV Zoo](https://github.com/opencv/opencv_zoo/tree/47534e27c9851bb1128ccc0102f1145e27f23f98/models/face_recognition_sface), Apache-2.0 |
| MediaPipe Face Landmarker | float16/1 | face_landmarker.task | [Modelo oficial](https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task), [Model Card Face Mesh V2](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Face%20Mesh%20V2.pdf), Apache-2.0 |

SHA-256:

```text
YuNet: 8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4
SFace: 0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79
FaceLandmarker: 64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff
```

OpenCV se comprueba contra los SHA publicados en los punteros Git LFS del commit fijado. El bundle de MediaPipe fija versión y SHA calculado durante preparación. No se utilizan pesos de InsightFace ni se descarga nada al iniciar. La evaluación de licencias cubre las distribuciones citadas; no constituye autorización para captar biometría sin consentimiento.
