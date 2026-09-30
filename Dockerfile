# Coronary Risk Explorer: API + frontend in one image.
#   docker build -t coronary-risk-explorer .
#   docker run -p 8000:8000 coronary-risk-explorer      ->  http://localhost:8000
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    WEB_CONCURRENCY=2

# XGBoost needs the OpenMP runtime.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgomp1 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install -r backend/requirements.txt

# Only what the service reads at runtime (see backend/app/config.py).
COPY backend backend
COPY frontend frontend
COPY artifacts/models artifacts/models
COPY artifacts/deployment artifacts/deployment
COPY artifacts/shap artifacts/shap
COPY artifacts/final_evaluation artifacts/final_evaluation
COPY artifacts/final_model_manifest.json artifacts/final_model_manifest.json
COPY preprocessing_config.json ./
COPY ["extention of Z-Alizadeh sani dataset.xlsx", "./"]

RUN useradd --system --uid 10001 --no-create-home app
USER app

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4)" || exit 1

# Behind a reverse proxy, set FORWARDED_ALLOW_IPS to the proxy's address so client IPs (rate limiting) and https
# (HSTS) are taken from X-Forwarded-* headers. The app writes its own access log without client addresses.
CMD ["sh", "-c", "exec uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --workers ${WEB_CONCURRENCY} --proxy-headers --no-access-log --timeout-graceful-shutdown 20"]
