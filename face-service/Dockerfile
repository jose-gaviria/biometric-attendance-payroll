FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 MPLCONFIGDIR=/tmp/matplotlib
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libportaudio2 && rm -rf /var/lib/apt/lists/*
WORKDIR /service
COPY requirements.lock ./
RUN pip install --no-cache-dir -r requirements.lock
COPY . .
RUN useradd --uid 10001 --create-home face
USER face
EXPOSE 5001
HEALTHCHECK --interval=15s --timeout=6s --start-period=60s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:5001/health',timeout=5)"
CMD ["uvicorn","main:app","--host","0.0.0.0","--port","5001","--workers","1","--no-access-log","--limit-concurrency","8"]
