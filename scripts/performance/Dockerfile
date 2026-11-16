# Official Playwright image and test package are both 1.64.1.
# The digest was verified directly at mcr.microsoft.com on 2026-11-16.
FROM mcr.microsoft.com/playwright:v1.64.1-noble@sha256:2f05f8a734509a7b3f26a912639488ee08f58a7b292d14d62271bcff9038768f
ENV CI=1 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm_config_cache=/tmp/new0-npm-cache
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY scripts/assets/package.json scripts/assets/package-lock.json ./scripts/assets/
RUN npm ci --prefix scripts/assets --no-audit --no-fund
COPY scripts/performance/package.json scripts/performance/package-lock.json ./scripts/performance/
RUN npm ci --prefix scripts/performance --no-audit --no-fund
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY public ./public
COPY scripts/performance ./scripts/performance
RUN npm --prefix scripts/performance run build
ENV NEW0_RESOURCE_CONTAINER=1 NEW0_RESOURCE_RESULTS=/results
WORKDIR /app/scripts/performance
CMD ["npm", "test"]
