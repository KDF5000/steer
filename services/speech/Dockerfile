ARG BASE_IMAGE=python:3.12-slim-bookworm
FROM ${BASE_IMAGE}
USER root
ARG APT_MIRROR=deb.debian.org
RUN sed -i "s|http://deb.debian.org|https://${APT_MIRROR}|g" /etc/apt/sources.list.d/debian.sources \
    && apt-get update && apt-get install -y --no-install-recommends ffmpeg libsndfile1 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN python -m venv /speech-venv
ENV PATH=/speech-venv/bin:$PATH
COPY requirements.docker.txt ./
ARG PIP_INDEX_URL=https://pypi.org/simple
RUN pip install --no-cache-dir --index-url "$PIP_INDEX_URL" -r requirements.docker.txt
COPY service.py ./
USER 65534:65534
ENTRYPOINT []
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 STEER_FFMPEG=/usr/bin/ffmpeg
CMD ["python", "-m", "uvicorn", "service:create_app", "--factory", "--host", "0.0.0.0", "--port", "8765", "--workers", "1", "--no-access-log", "--limit-concurrency", "8"]
