import base64
import hashlib
import io
import json
import logging
import math
import os
from pathlib import Path
import threading
import time

import cv2
import mediapipe as mp
import numpy as np
from PIL import Image

log = logging.getLogger('face-service')
Image.MAX_IMAGE_PIXELS = 1280 * 960


def eye_aspect(points, indexes):
    p = points[indexes, :2]
    return float((np.linalg.norm(p[1]-p[5]) + np.linalg.norm(p[2]-p[4])) / max(2*np.linalg.norm(p[0]-p[3]), 1e-6))


def quality_metrics(image, face):
    height, width = image.shape[:2]
    x, y, w, h = [float(v) for v in face[:4]]
    x0, y0 = max(0, int(x)), max(0, int(y))
    crop = image[y0:min(height, int(y+h)), x0:min(width, int(x+w))]
    if crop.size == 0:
        return {'accepted': False, 'reason': 'position', 'quality_score': 0}
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    gray = cv2.resize(gray, (160, 160))
    blur = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    light = float(gray.mean())
    clipped = float(np.mean(gray > 245))
    area = w*h/(width*height)
    center = max(abs((x+w/2)/width-.5), abs((y+h/2)/height-.5))
    score = .35*min(blur/180, 1) + .30*max(0, 1-abs(light-130)/130) + .20*min(area/.16, 1) + .15*max(0, 1-center/.4)
    reason = 'ok'
    if w/width < .16 or h/height < .20:
        reason = 'too_small'
    elif x < 0 or y < 0 or x+w > width or y+h > height or center > .25:
        reason = 'position'
    elif light < 48:
        reason = 'dark'
    elif light > 215 or clipped > .35:
        reason = 'overexposed'
    elif blur < 45:
        reason = 'blur'
    return dict(accepted=reason == 'ok', reason=reason, quality_score=round(score, 4), blur=round(blur, 2), illumination=round(light, 2), clipped=round(clipped, 3), face_ratio=round(area, 3))


class FaceEngine:
    def __init__(self, models_dir=None):
        root = Path(models_dir or os.environ.get('MODELS_DIR', Path(__file__).parent / 'models'))
        self.manifest = json.loads((root/'manifest.json').read_text())
        for model in self.manifest:
            if hashlib.sha256((root/model['file']).read_bytes()).hexdigest() != model['sha256']:
                raise RuntimeError('Model checksum mismatch: '+model['name'])
        cv2.setNumThreads(2)
        self.detector = cv2.FaceDetectorYN.create(str(root/self.manifest[0]['file']), '', (640,480), .85, .3, 5000, cv2.dnn.DNN_BACKEND_OPENCV, cv2.dnn.DNN_TARGET_CPU)
        log.info('YuNet loaded')
        self.recognizer = cv2.FaceRecognizerSF.create(str(root/self.manifest[1]['file']), '', cv2.dnn.DNN_BACKEND_OPENCV, cv2.dnn.DNN_TARGET_CPU)
        log.info('SFace loaded')
        options = mp.tasks.vision.FaceLandmarkerOptions(base_options=mp.tasks.BaseOptions(model_asset_path=str(root/self.manifest[2]['file']), delegate=mp.tasks.BaseOptions.Delegate.CPU), running_mode=mp.tasks.vision.RunningMode.IMAGE, num_faces=2)
        self.landmarker = mp.tasks.vision.FaceLandmarker.create_from_options(options)
        log.info('landmarks loaded')
        self.lock = threading.Lock()
        self.model_version = self.manifest[1]['version']+':'+self.manifest[1]['sha256'][:12]
        # Real inference checks the detector and recognizer, not only file existence.
        blank = np.zeros((480,640,3), dtype=np.uint8)
        self.detector.detect(blank)
        vector = self.recognizer.feature(np.zeros((112,112,3),dtype=np.uint8)).flatten()
        if vector.size != 128 or not np.isfinite(vector).all():
            raise RuntimeError('Invalid recognizer output')
        self.landmarker.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=blank))
        self.ready = True

    def decode(self, encoded):
        try:
            data = base64.b64decode(encoded, validate=True)
            if len(data) > 350_000 or data[:2] != b'\xff\xd8':
                raise ValueError()
            with Image.open(io.BytesIO(data)) as header:
                width, height = header.size
                if header.format != 'JPEG' or not (160 <= width <= 1280 and 120 <= height <= 960):
                    raise ValueError()
                header.verify()
            image = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
            if image is None:
                raise ValueError()
            return image, hashlib.sha256(data).hexdigest()
        except Exception as error:
            raise ValueError('invalid_image') from error

    def analyze(self, encoded):
        started = time.perf_counter()
        image, digest = self.decode(encoded)
        if not self.lock.acquire(blocking=False):
            raise BlockingIOError('busy')
        try:
            height, width = image.shape[:2]
            self.detector.setInputSize((width,height))
            tick = time.perf_counter()
            _, faces = self.detector.detect(image)
            detection_ms = (time.perf_counter()-tick)*1000
            count = 0 if faces is None else len(faces)
            result = dict(face_count=count, accepted=False, reason='no_face' if count == 0 else 'multiple_faces', digest=digest, model_name='SFace', model_version=self.model_version, timings=dict(detection_ms=round(detection_ms,2),embedding_ms=0,landmarks_ms=0,total_ms=0))
            if count != 1:
                return result
            face = faces[0]
            result.update(quality_metrics(image, face))
            result['box'] = [float(v) for v in face[:4]]
            if not result['accepted']:
                return result
            tick = time.perf_counter()
            mesh = self.landmarker.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(image, cv2.COLOR_BGR2RGB)))
            result['timings']['landmarks_ms'] = round((time.perf_counter()-tick)*1000, 2)
            if len(mesh.face_landmarks) != 1:
                result.update(accepted=False, reason='landmarks')
                return result
            points = np.array([(p.x*width, p.y*height, p.z*width) for p in mesh.face_landmarks[0]])
            eyes = (points[33]+points[263])/2
            distance = max(np.linalg.norm(points[33,:2]-points[263,:2]), 1)
            # Signed horizontal nose displacement in eye-aligned coordinates.
            eye_axis = (points[263,:2]-points[33,:2])/distance
            yaw = float(np.dot(points[1,:2]-eyes[:2], eye_axis)/distance)
            pitch = float((points[1,1]-eyes[1])/distance)
            roll = math.degrees(math.atan2(points[263,1]-points[33,1], points[263,0]-points[33,0]))
            ear = (eye_aspect(points, [33,160,158,133,153,144])+eye_aspect(points,[362,385,387,263,373,380]))/2
            result.update(yaw=round(yaw,4), ear=round(ear,4), pitch=round(pitch,4), landmarks=[[round(float(v),1) for v in points[i,:2]] for i in [33,263,1,61,291]])
            if abs(yaw) > .65 or abs(roll) > 25 or not (-.15 < pitch < .95):
                result.update(accepted=False, reason='pose')
                return result
            tick = time.perf_counter()
            aligned = self.recognizer.alignCrop(image, face)
            embedding = self.recognizer.feature(aligned).flatten().astype(np.float32)
            norm = np.linalg.norm(embedding)
            if embedding.size != 128 or not np.isfinite(embedding).all() or norm < 1e-8:
                raise RuntimeError('Invalid embedding')
            result['embedding'] = (embedding/norm).tolist()
            result['timings']['embedding_ms'] = round((time.perf_counter()-tick)*1000,2)
            return result
        finally:
            if 'result' in locals():
                result['timings']['total_ms'] = round((time.perf_counter()-started)*1000,2)
            self.lock.release()
