# syntax=docker/dockerfile:1

ARG AGENT_BASE_IMAGE=local-agentic-dev/codex-agent:dev

# Keep the first base image explicit so Dependabot can propose its updates.
# Coordinate this pin with NODE_VERSION below and the devcontainer setup check.
FROM node:26.12.0-trixie AS node-runtime

# Match browser revisions to the repository's locked Playwright version. Keep
# downloads in a separate stage so source changes do not invalidate this cache.
FROM node-runtime AS playwright-browsers
COPY package-lock.json /tmp/package-lock.json
RUN set -eu; \
    playwright_version="$(node -p "require('/tmp/package-lock.json').packages['node_modules/@playwright/test'].version")"; \
    npm install --prefix /tmp/playwright-cli --no-save --no-package-lock --ignore-scripts "@playwright/test@${playwright_version}"; \
    PLAYWRIGHT_BROWSERS_PATH=/opt/playwright-browsers /tmp/playwright-cli/node_modules/.bin/playwright install chromium firefox webkit

FROM ${AGENT_BASE_IMAGE}

ARG NODE_VERSION=24.22.0

USER root

COPY --from=node-runtime /usr/local/ /usr/local/
COPY --from=playwright-browsers --chown=vscode:vscode /opt/playwright-browsers /opt/playwright-browsers
COPY --from=playwright-browsers /tmp/playwright-cli /tmp/playwright-cli
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright-browsers

# Let the matching Playwright CLI maintain the complete dependency list for all
# three browser engines in the final agent image.
RUN /tmp/playwright-cli/node_modules/.bin/playwright install-deps chromium firefox webkit \
    && rm -rf /tmp/playwright-cli \
    && rm -rf /var/lib/apt/lists/*

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        # Useful for native Node dependency fallback builds
        python3 \
        make \
        g++ \
        pkg-config \
        # Useful when debugging uploaded/image files
        file \
    && rm -rf /var/lib/apt/lists/*

# Agent containers should not maintain a persistent Nx daemon or contact
# a configured Nx remote cache.
ENV NX_DAEMON=false \
    NX_DISABLE_REMOTE_CACHE=true \
    NX_SKIP_NATIVE_FILE_CACHE=true

RUN test "$(node --version)" = "v${NODE_VERSION}" \
    && test "$(npm --version)" = "11.19.1" \
    && node --version \
    && npm --version \
    && python3 --version \
    && g++ --version

USER vscode

WORKDIR /workspaces
