FROM node:22-bookworm-slim AS node

FROM python:3.12-slim-bookworm
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl git ripgrep \
    && rm -rf /var/lib/apt/lists/*

ARG OPENCODE_VERSION=1.19.5
RUN npm install --global "opencode-ai@${OPENCODE_VERSION}" \
    && npm cache clean --force \
    && useradd --uid 10001 --create-home --shell /bin/sh asf

COPY caddy-root.crt /usr/local/share/ca-certificates/caddy-local.crt
RUN update-ca-certificates
ENV NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/caddy-local.crt \
    OPENCODE_DISABLE_AUTOUPDATE=true \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HOME=/home/asf
USER 10001:10001
WORKDIR /workspace
CMD ["opencode", "--version"]
