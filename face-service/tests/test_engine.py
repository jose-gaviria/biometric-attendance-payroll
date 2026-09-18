"""Real CPU model tests. Input fixtures arrive via stdin, are never written to disk.
Geometric liveness and challenge lifecycle are tested in Node, the owning layer.
"""
import base64
import json
import sys
import time
import unittest
import urllib.request
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from engine import FaceEngine, quality_metrics, eye_aspect

FIXTURES = json.load(sys.stdin)

def jpeg(image):
    ok, encoded = cv2.imencode('.jpg', image, [cv2.IMWRITE_JPEG_QUALITY, 85])
    assert ok
    return base64.b64encode(encoded).decode()

class EngineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = FaceEngine()
        def centered(data):
            image = cv2.imdecode(np.frombuffer(base64.b64decode(data), np.uint8),cv2.IMREAD_COLOR)
            h,w = image.shape[:2]
            cls.engine.detector.setInputSize((w,h))
            _,faces=cls.engine.detector.detect(image)
            if faces is None:
                raise RuntimeError('No face in test fixture')
            x,y,fw,fh=faces[0,:4]
            side=int(max(fw,fh)*2.4)
            cx,cy=int(x+fw/2),int(y+fh/2)
            padded=cv2.copyMakeBorder(image,side,side,side,side,cv2.BORDER_REFLECT)
            crop=padded[cy+side-side//2:cy+side+side//2,cx+side-side//2:cx+side+side//2]
            return cv2.resize(crop,(480,480))
        cls.a=centered(FIXTURES['a']);cls.b=centered(FIXTURES['b'])
        cls.result=cls.engine.analyze(jpeg(cls.a))
        cls.other=cls.engine.analyze(jpeg(cls.b))

    def test_health_real_http(self):
        response=json.load(urllib.request.urlopen('http://localhost:5001/health',timeout=5))
        self.assertEqual(response['status'],'healthy')
        self.assertTrue(all(response['models'].values()))

    def test_models_loaded_once(self):
        self.assertTrue(self.engine.ready)
        before=id(self.engine.recognizer)
        self.engine.analyze(jpeg(self.a))
        self.assertEqual(before,id(self.engine.recognizer))

    def test_invalid_image(self):
        with self.assertRaises(ValueError):self.engine.analyze('a'*80)

    def test_no_face(self):
        self.assertEqual(self.engine.analyze(jpeg(np.zeros((480,640,3),np.uint8)))['face_count'],0)

    def test_single_face(self):
        self.assertEqual(self.result['face_count'],1)
        self.assertTrue(self.result['accepted'],self.result)

    def test_multiple_faces(self):
        image=np.concatenate([self.a,self.b],axis=1)
        result=self.engine.analyze(jpeg(image))
        self.assertGreaterEqual(result['face_count'],2)
        self.assertFalse(result['accepted'])

    def test_blur(self):
        image=cv2.GaussianBlur(self.a,(61,61),18)
        metrics=quality_metrics(image,[110,90,260,290])
        self.assertEqual(metrics['reason'],'blur')
        self.assertFalse(self.engine.analyze(jpeg(image))['accepted'])

    def test_dark(self):
        image=(self.a.astype(float)*.1).astype(np.uint8)
        self.assertEqual(quality_metrics(image,[110,90,260,290])['reason'],'dark')
        self.assertFalse(self.engine.analyze(jpeg(image))['accepted'])

    def test_overexposure(self):
        image=np.clip(self.a.astype(float)*.1+230,0,255).astype(np.uint8)
        self.assertEqual(quality_metrics(image,[110,90,260,290])['reason'],'overexposed')
        self.assertFalse(self.engine.analyze(jpeg(image))['accepted'])

    def test_embedding_dimension_finite_normalized(self):
        vector=np.array(self.result['embedding'])
        self.assertEqual(vector.size,128);self.assertTrue(np.isfinite(vector).all());self.assertAlmostEqual(np.linalg.norm(vector),1,places=5)

    def test_same_person_relative_similarity(self):
        changed=cv2.convertScaleAbs(self.a,alpha=.92,beta=7)
        result=self.engine.analyze(jpeg(changed))
        self.assertTrue(result['accepted'])
        same=float(np.dot(self.result['embedding'],result['embedding']))
        other=float(np.dot(self.result['embedding'],self.other['embedding']))
        print('REAL_MODEL_METRICS',json.dumps({'same_image_lighting_variant':same,'different_portraits':other,'timings':self.result['timings'],'quality':self.result['quality_score'],'ear':self.result['ear'],'yaw':self.result['yaw']}),flush=True)
        self.assertGreater(same,.75);self.assertGreater(same,other+.2)

    def test_landmarks(self):
        self.assertEqual(len(self.result['landmarks']),5)
        self.assertGreater(self.result['ear'],0)
        self.assertTrue(np.isfinite(self.result['yaw']))

    def test_too_small_and_position(self):
        self.assertEqual(quality_metrics(self.a,[200,200,20,20])['reason'],'too_small')
        self.assertEqual(quality_metrics(self.a,[0,0,130,140])['reason'],'position')

    def test_oversized_dimensions_before_decode(self):
        with self.assertRaises(ValueError):self.engine.analyze(jpeg(np.zeros((1000,1500,3),np.uint8)))

    def test_eye_geometry(self):
        points=np.array([[0,0],[1,1],[3,1],[4,0],[3,-1],[1,-1]],float)
        self.assertAlmostEqual(eye_aspect(points,list(range(6))),.5)

if __name__=='__main__':
    unittest.main(verbosity=2)
