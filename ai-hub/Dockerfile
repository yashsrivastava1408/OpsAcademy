FROM python:3.11-slim

WORKDIR /app

# Copy requirements
COPY requirements.txt requirements-semantic.txt ./

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Sentence embeddings for retrieval (agents/embedder.py). On by default: the
# model is downloaded into the image here, so the container needs no network
# for it at run time. It adds about 450 MB of memory (the hub settles near
# 600 MB in a container instead of about 125 MB); build with
# --build-arg WITH_SEMANTIC=false for a small host, and the hub uses its
# lexical rankers only.
ARG WITH_SEMANTIC=true
ENV MODEL_CACHE_DIR=/opt/models
RUN if [ "$WITH_SEMANTIC" = "true" ]; then \
      pip install --no-cache-dir -r requirements-semantic.txt \
      && python -c "from fastembed import TextEmbedding; list(TextEmbedding('sentence-transformers/all-MiniLM-L6-v2', cache_dir='/opt/models').embed(['warm up']))" \
      && chmod -R a+rX /opt/models; \
    fi

# Copy AI Hub application code
COPY . .

# Run as an unprivileged user
RUN useradd --system --uid 10001 hub && chown -R hub /app
USER hub

# Expose microservice port
EXPOSE 5000

ENV PORT=5000
ENV FLASK_ENV=production

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s \
  CMD python -c "import os,urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ[\"PORT\"]}/health', timeout=2)"

# gunicorn, not the Flask development server. Threads share the in-memory hint cache.
# Keep-alive is longer than the gateway's idle socket timeout, so the gateway is
# the side that closes idle connections and never writes to a dead one.
CMD ["sh", "-c", "exec gunicorn --bind 0.0.0.0:${PORT} --workers 1 --threads 8 --timeout 30 --keep-alive 15 app:app"]
