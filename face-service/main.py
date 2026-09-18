from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from engine import FaceEngine

logging.basicConfig(level=logging.INFO, format='%(levelname)s %(message)s')
engine = None

@asynccontextmanager
async def lifespan(app):
    global engine
    engine = FaceEngine()
    logging.info('face-service started')
    yield
    engine.ready = False
    engine.landmarker.close()

app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

class Frame(BaseModel):
    model_config = ConfigDict(extra='forbid')
    image: str = Field(min_length=20,max_length=470000)

@app.get('/health')
def health():
    if engine is None or not engine.ready:
        raise HTTPException(503, 'Models unavailable')
    return {'status':'healthy','models':{'detector':True,'recognizer':True,'landmarks':True},'model_name':'SFace','model_version':engine.model_version,'dimension':128}

@app.post('/analyze')
def analyze(frame: Frame):
    if engine is None or not engine.ready:
        raise HTTPException(503,'Models unavailable')
    try:
        return engine.analyze(frame.image)
    except ValueError:
        raise HTTPException(422,'invalid_image') from None
    except BlockingIOError:
        raise HTTPException(503,'busy') from None
    except Exception:
        logging.error('Inference failed; request content omitted')
        raise HTTPException(503,'inference_unavailable') from None
