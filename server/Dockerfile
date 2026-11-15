FROM python:3.12-slim@sha256:5e2bdb1b0d542d5039cffb8181c65930093949194a65c365dfb1b0fe13a4fa5b AS base
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
RUN useradd --uid 10001 --create-home game && mkdir /data && chown game:game /data
USER game
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]

FROM base AS test
USER root
COPY requirements-test.txt ./
RUN pip install --no-cache-dir -r requirements-test.txt
COPY tests ./tests
USER game
CMD ["python", "-m", "pytest", "-q", "-o", "cache_dir=/tmp/new0-pytest"]
