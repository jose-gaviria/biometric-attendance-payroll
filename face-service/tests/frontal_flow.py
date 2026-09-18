"""Frontal API regression against disposable verification app, using real inference."""
import base64
import http.cookiejar
import json
import sys
import time
import urllib.error
import urllib.request
import cv2
import numpy as np
from engine import FaceEngine

fixtures=json.load(sys.stdin)
engine=FaceEngine()
image=cv2.imdecode(np.frombuffer(base64.b64decode(fixtures['a']),np.uint8),cv2.IMREAD_COLOR)
h,w=image.shape[:2];engine.detector.setInputSize((w,h));_,faces=engine.detector.detect(image)
x,y,fw,fh=faces[0,:4];side=int(max(fw,fh)*2.4);cx,cy=int(x+fw/2),int(y+fh/2)
pad=cv2.copyMakeBorder(image,side,side,side,side,cv2.BORDER_REFLECT)
image=cv2.resize(pad[cy+side-side//2:cy+side+side//2,cx+side-side//2:cx+side+side//2],(480,480))
opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
def request(path,body=None,method=None):
    data=json.dumps(body).encode() if body is not None else None
    req=urllib.request.Request('http://app:8080/api'+path,data=data,method=method,headers={'Origin':'http://localhost:8092','Content-Type':'application/json'})
    with opener.open(req,timeout=15) as r:return json.load(r)
request('/login',{'password':'Solo-prueba-local-8092'})
challenge=request('/challenges',{'purpose':'identify'})
assert challenge['mode']=='frontal' and challenge['required']==4
states=[];started=time.perf_counter()
for i in range(4):
    variant=cv2.convertScaleAbs(image,alpha=1-i*.01,beta=i)
    _,jpeg=cv2.imencode('.jpg',variant,[cv2.IMWRITE_JPEG_QUALITY,85])
    result=request('/challenges/'+challenge['id']+'/frame',{'nonce':challenge['nonce'],'image':base64.b64encode(jpeg).decode()})
    states.append(result['status'])
    assert result['status']!='liveness',result
    time.sleep(.38)
assert result['status']=='result' and result['reason']=='unknown',result
assert result['samples']==4
try:
    request('/challenges/'+challenge['id']+'/frame',{'nonce':challenge['nonce'],'image':base64.b64encode(jpeg).decode()})
    raise AssertionError('Reused challenge was accepted')
except urllib.error.HTTPError as error:
    assert error.code==409,error.code
logs=request('/logs')
assert logs['identifications'][0]['liveness_passed']==0
print('FRONTAL_HTTP_VERIFIED',json.dumps({'states':states,'unknown_rejected':True,'replay_rejected':True,'active_liveness_claimed':False,'sequence_ms':round((time.perf_counter()-started)*1000,2)}))
