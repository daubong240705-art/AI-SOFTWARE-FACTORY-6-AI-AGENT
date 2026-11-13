# Factory Host + UI in one image. Agents and the Lead chat run on the Claude Code and Codex CLIs that are
# installed on the machine running Docker: compose.yaml mounts them read-only (see docker/README.md).
#
#   docker compose build
#   docker compose up -d        # http://127.0.0.1:8787

ARG NODE_IMAGE=node:22.23.4-trixie-slim
ARG PYTHON_IMAGE=python:3.14-slim-trixie

# ---- build: contracts, Host and UI, then production dependencies only ----
FROM ${NODE_IMAGE} AS build
WORKDIR /src
COPY packages/factory-contracts packages/factory-contracts
COPY apps/factory-host apps/factory-host
COPY apps/factory-ui apps/factory-ui
COPY design design
COPY packs packs
# Contracts first: the Host and the UI link to them with file:../../packages/factory-contracts.
RUN cd packages/factory-contracts && npm ci --ignore-scripts --no-audit --no-fund && npm run build \
 && cd /src/apps/factory-host && npm ci --ignore-scripts --no-audit --no-fund && npm run build \
 && cd /src/apps/factory-ui && npm ci --ignore-scripts --no-audit --no-fund && npm run build
# Same layout as scripts/factory-v2/deploy-host-wsl.sh: the Host finds packs, migrations, workers and the UI by relative path.
RUN mkdir -p /app/apps/factory-host /app/apps/factory-ui /app/packages/factory-contracts \
 && cp -r packages/factory-contracts/package.json packages/factory-contracts/package-lock.json packages/factory-contracts/dist /app/packages/factory-contracts/ \
 && cp -r apps/factory-host/package.json apps/factory-host/package-lock.json apps/factory-host/dist apps/factory-host/migrations apps/factory-host/workers /app/apps/factory-host/ \
 && cp -r apps/factory-ui/dist /app/apps/factory-ui/ \
 && cp -r packs /app/packs \
 && cd /app/packages/factory-contracts && npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
 && cd /app/apps/factory-host && npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
 && node -e "require('/app/apps/factory-host/node_modules/better-sqlite3')(':memory:').close()"

# ---- document extraction worker (PDF, Word, Excel, PowerPoint), pinned by hash ----
FROM ${PYTHON_IMAGE} AS docworker
COPY scripts/factory-v2/doc-worker/requirements.lock /tmp/requirements.lock
RUN python -m venv /opt/doc-worker/venv \
 && /opt/doc-worker/venv/bin/python -m pip install --no-cache-dir --quiet --require-hashes --only-binary=:all: -r /tmp/requirements.lock

# ---- runtime ----
FROM ${PYTHON_IMAGE}
ARG NODE_IMAGE
LABEL org.opencontainers.image.title="Factory Host" \
      org.opencontainers.image.description="Factory V2 Host and UI; agents run on the operator's Claude Code and Codex CLIs"
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates bubblewrap libstdc++6 procps \
 && rm -rf /var/lib/apt/lists/*
# Node is a single binary; npm is not needed at runtime (Codex's launcher only needs node).
COPY --from=build /usr/local/bin/node /usr/local/bin/node
COPY --from=build /app /app
COPY --from=docworker /opt/doc-worker /opt/doc-worker
COPY docker/entrypoint.sh /usr/local/bin/factory-entrypoint
COPY docker/claude.sh /usr/local/bin/claude
COPY docker/codex.sh /usr/local/bin/codex
RUN chmod 0755 /usr/local/bin/factory-entrypoint /usr/local/bin/claude /usr/local/bin/codex \
 && mkdir -p /data /home/factory && node --version

ENV HOME=/home/factory \
    FACTORY_PORT=8787 \
    FACTORY_STATE_DIR=/data/state \
    FACTORY_PROJECTS_ROOT=/data/workspaces \
    FACTORY_WORKTREES_ROOT=/data/worktrees \
    FACTORY_DOC_WORKER_PYTHON=/opt/doc-worker/venv/bin/python \
    FACTORY_LOCAL_CLI=1 \
    FACTORY_LEAD_CLI=claude \
    DISABLE_AUTOUPDATER=1
WORKDIR /data
ENTRYPOINT ["/usr/local/bin/factory-entrypoint"]
CMD ["host"]
