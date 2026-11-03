FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ARG RELEASE_SHA=development
LABEL org.opencontainers.image.revision=$RELEASE_SHA
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
RUN groupadd --gid 10001 asf && useradd --uid 10001 --gid asf --create-home asf
COPY --from=build --chown=asf:asf /app/.next/standalone ./
COPY --from=build --chown=asf:asf /app/.next/static ./.next/static
USER 10001:10001
EXPOSE 3000
CMD ["node", "server.js"]
