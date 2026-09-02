# syntax=docker/dockerfile:1

ARG NODE_VERSION=24.19.0
ARG AGENT_BASE_IMAGE=local-agentic-dev/codex-agent:dev

FROM node:${NODE_VERSION}-trixie AS node-runtime

FROM ${AGENT_BASE_IMAGE}

USER root

COPY --from=node-runtime /usr/local/ /usr/local/

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        # Useful for native Node dependency fallback builds
        python3 \
        make \
        g++ \
        pkg-config \
        \
        # Useful when debugging uploaded/image files
        file \
        \
        # Chromium / Playwright runtime dependencies
        libasound2t64 \
        libatk-bridge2.0-0t64 \
        libatk1.0-0t64 \
        libatspi2.0-0t64 \
        libcairo2 \
        libcups2t64 \
        libdbus-1-3 \
        libdrm2 \
        libfontconfig1 \
        libfreetype6 \
        libgbm1 \
        libglib2.0-0t64 \
        libnspr4 \
        libnss3 \
        libpango-1.0-0 \
        libx11-6 \
        libxcb1 \
        libxcomposite1 \
        libxdamage1 \
        libxext6 \
        libxfixes3 \
        libxkbcommon0 \
        libxrandr2 \
    && rm -rf /var/lib/apt/lists/*

# Agent containers should not maintain a persistent Nx daemon or contact
# a configured Nx remote cache.
ENV NX_DAEMON=false \
    NX_DISABLE_REMOTE_CACHE=true

RUN node --version \
    && npm --version \
    && python3 --version \
    && g++ --version

USER vscode

WORKDIR /workspaces