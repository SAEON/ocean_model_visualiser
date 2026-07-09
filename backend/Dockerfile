FROM python:3.11-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libgeos-dev \
    libnetcdf-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy and install python dependencies
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY . /app/backend

# Expose port
EXPOSE 8001

# Command to run backend
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8001"]
