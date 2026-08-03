FROM python:3.11-slim

WORKDIR /app

# Copy requirements
COPY requirements.txt ./

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy AI Hub application code
COPY . .

# Expose microservice port
EXPOSE 5000

ENV PORT=5000
ENV FLASK_ENV=production

CMD ["python", "app.py"]
