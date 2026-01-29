# TechStax Webhook Receiver - Dockerfile
# =======================================
# Multi-stage build using uv for fast dependency installation.

FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

# Set working directory
WORKDIR /app

# Enable bytecode compilation for faster startup
ENV UV_COMPILE_BYTECODE=1

# Copy from the cache instead of linking since it's a mounted volume
ENV UV_LINK_MODE=copy

# Copy dependency files first for better caching
COPY pyproject.toml uv.lock ./

# Install dependencies using uv
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project

# Copy application code
COPY main.py .
COPY static/ static/

# Expose port
EXPOSE 8000

# Run the application
CMD ["uv", "run", "python", "main.py"]
