FROM python:3.12-slim-bookworm
ARG UV_VERSION=0.13.7
RUN pip install --no-cache-dir "uv==${UV_VERSION}"
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PATH=/app/.venv/bin:$PATH
WORKDIR /app
COPY pyproject.toml uv.lock ./
COPY apps/api/src apps/api/src
COPY shared shared
COPY agents agents
COPY integrations integrations
COPY orchestrator orchestrator
COPY workers workers
RUN uv sync --frozen --no-dev
COPY alembic.ini ./
COPY infrastructure/migrations infrastructure/migrations
RUN useradd --uid 10001 --create-home asf
USER 10001:10001
EXPOSE 8000
CMD ["uvicorn", "asf_api.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
