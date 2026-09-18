"""Herramienta de preparación ONLINE explícita. Nunca se importa en runtime."""
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
MODELS = ROOT / 'face-service' / 'models'
COMMIT = '47534e27c9851bb1128ccc0102f1145e27f23f98'
SPECS = [
    ('YuNet', '2023mar', 'face_detection_yunet_2023mar.onnx', 'face_detection_yunet', 'MIT'),
    ('SFace', '2021dec', 'face_recognition_sface_2021dec.onnx', 'face_recognition_sface', 'Apache-2.0'),
    ('FaceLandmarker', 'float16/1', 'face_landmarker.task', None, 'Apache-2.0'),
]

def main():
    MODELS.mkdir(parents=True, exist_ok=True)
    existing = json.loads((MODELS / 'manifest.json').read_text()) if (MODELS / 'manifest.json').exists() else []
    manifest = []
    for name, version, filename, folder, license_name in SPECS:
        url = f'https://media.githubusercontent.com/media/opencv/opencv_zoo/{COMMIT}/models/{folder}/{filename}' if folder else 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
        path = MODELS / filename
        if not path.exists():
            print('Preparando', name, flush=True)
            with urllib.request.urlopen(url, timeout=180) as response:
                data = response.read()
            path.write_bytes(data)
        checksum = hashlib.sha256(path.read_bytes()).hexdigest()
        previous = next((m for m in existing if m['file'] == filename), None)
        if previous and checksum != previous['sha256']:
            raise RuntimeError(f'Checksum incompatible: {filename}')
        if folder:
            # Git LFS pointer contains an independently published SHA-256.
            pointer = urllib.request.urlopen(f'https://raw.githubusercontent.com/opencv/opencv_zoo/{COMMIT}/models/{folder}/{filename}', timeout=60).read().decode()
            if f'oid sha256:{checksum}' not in pointer:
                raise RuntimeError(f'Checksum no coincide con Git LFS: {filename}')
            license_url = f'https://raw.githubusercontent.com/opencv/opencv_zoo/{COMMIT}/models/{folder}/LICENSE'
        else:
            license_url = 'https://raw.githubusercontent.com/google-ai-edge/mediapipe/master/LICENSE'
        license_text=urllib.request.urlopen(license_url, timeout=60).read()
        (ROOT / 'licenses' / f'{name}-LICENSE.txt').write_bytes(license_text)
        (MODELS / f'{name}-LICENSE.txt').write_bytes(license_text)
        manifest.append(dict(name=name,version=version,file=filename,source=url,license=license_name,sha256=checksum))
        print(name, checksum, flush=True)
    (MODELS / 'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')

if __name__ == '__main__':
    main()
