"""Runs via docker exec inside a --network none synthetic test container."""
import base64
import http.cookiejar
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, '/service')
import cv2
import numpy as np
from engine import FaceEngine

engine = FaceEngine()
fixture = json.load(sys.stdin)
image = cv2.imdecode(np.frombuffer(base64.b64decode(fixture['image']),np.uint8),cv2.IMREAD_COLOR)
h,w=image.shape[:2];engine.detector.setInputSize((w,h));_,faces=engine.detector.detect(image)
x,y,fw,fh=faces[0,:4];side=int(max(fw,fh)*2.4);cx,cy=int(x+fw/2),int(y+fh/2)
pad=cv2.copyMakeBorder(image,side,side,side,side,cv2.BORDER_REFLECT)
image=cv2.resize(pad[cy+side-side//2:cy+side+side//2,cx+side-side//2:cx+side+side//2],(480,480))
frames=[]
for i in range(4):
    variant=cv2.convertScaleAbs(image,alpha=1-i*.01,beta=i)
    _,jpeg=cv2.imencode('.jpg',variant,[cv2.IMWRITE_JPEG_QUALITY,85])
    frames.append(base64.b64encode(jpeg).decode())
inference=engine.analyze(frames[0]);assert inference['accepted']
engine.landmarker.close()
opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


def request(path,body=None,method=None,expected=200):
    req=urllib.request.Request('http://127.0.0.1:3001/api'+path,data=json.dumps(body).encode() if body is not None else None,
                               method=method,headers={'Origin':'http://localhost:8080','Content-Type':'application/json'})
    try:
        with opener.open(req,timeout=15) as response:
            assert response.status==expected,(path,response.status)
            return json.load(response)
    except urllib.error.HTTPError as error:
        assert error.code==expected,(path,error.code,error.read().decode())
        return json.load(error)


request('/face/profiles',expected=403)
request('/admin/login',{'password':'Test-unified-4826'})
employee=request('/admin/employees',{'code':'TEST-UNIFIED','name':'Prueba contenedor único','role':'Prueba','monthly_salary':2000000,
                                    'pin':'4826','work_days':[1,2,3,4,5],'scheduled_start':'08:00','scheduled_end':'15:00'},expected=201)['id']
profile=request('/face/profiles',{'display_name':'Fixture sintético'},expected=201)['id']
request('/face/links/'+str(employee),{'profile_id':profile},'PUT')
request('/face/challenges',{'purpose':'enroll','profile_id':profile,'consent':False},expected=400)
enrollment=request('/face/challenges',{'purpose':'enroll','profile_id':profile,'consent':True},expected=201)
assert enrollment['mode']=='active' and enrollment['required']==6
request('/face/challenges/'+enrollment['id'],method='DELETE')
# Seed only this synthetic gallery to test the full recognition/attendance path.
seed="""const D=require('better-sqlite3'),{randomUUID}=require('node:crypto');let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const v=JSON.parse(s),d=new D('/data/face/face-lab.sqlite'),b=Buffer.alloc(512);v.vector.forEach((x,i)=>b.writeFloatLE(x,i*4));for(let n=0;n<6;n++)d.prepare('INSERT INTO face_templates(id,profile_id,embedding,sample_number,quality_score,model_name,model_version,created_at) VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),v.id,b,n,.9,'SFace',v.version,Date.now());d.close();});"""
subprocess.run(['node','-e',seed],cwd='/opt/face-lab',input=json.dumps({'id':profile,'vector':inference['embedding'],'version':inference['model_version']}),text=True,check=True)
request('/face/profiles/'+profile,{'active':True},'PATCH')
request('/admin/logout',{},'POST')


def identify(action):
    challenge=request('/face/challenges',{'purpose':'identify','action':action},expected=201)
    assert challenge['mode']=='frontal' and challenge['required']==4
    states=[]
    for frame in frames:
        result=request('/face/challenges/'+challenge['id']+'/frame',{'nonce':challenge['nonce'],'image':frame})
        states.append(result['status']);time.sleep(.38)
    assert states==['sampling','sampling','sampling','result'],states
    assert result['accepted'] and 'profile_id' not in result,result
    assert result['attendance']['action']==action,result
    retry=request('/face/challenges/'+challenge['id']+'/frame',{'nonce':challenge['nonce'],'image':frames[-1]})
    assert retry['attendance']==result['attendance']
    return states


states=identify('in');identify('out')
# PIN is session/action-bound and unlocks only after three distinct failed attempts.
for action in ['in','out']:
    payload={'employee_id':employee,'action':action,'pin':'4826'}
    request('/clock',payload,expected=403)
    for n in range(3):
        attempt=request('/face/attempts',{'action':action})
        path='/face/attempts/'+attempt['id']+'/camera-error'
        state=request(path,{'reason':'NotFoundError'})
        duplicate=request(path,{'reason':'NotFoundError'})
        assert state['failures']==n+1 and duplicate==state
        assert state['allowed']==(n==2)
        if n<2: request('/clock',payload,expected=403)
    request('/clock',{**payload,'pin':'9999'},expected=401)
    request('/clock',payload)
    request('/clock',payload,expected=403)
    time.sleep(.01)
request('/admin/login',{'password':'Test-unified-4826'})
shifts=request('/admin/shifts');assert len(shifts)==2 and all(s['clock_out'] for s in shifts)
with sqlite3.connect('/data/face/face-lab.sqlite') as db:
    assert db.execute('SELECT count(*) FROM face_templates').fetchone()[0]==6
    assert db.execute('SELECT max(liveness_passed) FROM face_identification_log').fetchone()[0]==0
report={'real_inference':True,'states':states,'face_entry_exit':True,'pin_entry_exit':True,'pin_three_failures_gate':True,
        'one_time_result':True,'enrollment_consent_and_active_challenge':True,'external_network':False}
print('UNIFIED_FLOW_OK '+json.dumps(report))
