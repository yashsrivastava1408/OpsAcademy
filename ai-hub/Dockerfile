FROM python:3.11-slim

WORKDIR /app

# Copy requirements
COPY requirements.txt ./

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

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
