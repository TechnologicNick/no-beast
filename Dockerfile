FROM oven/bun:1.3.14-slim

WORKDIR /app

COPY package.json bun.lock ./

RUN bun install --ci

RUN useradd -m nonroot

COPY datasets/scam/ datasets/scam/
COPY tsconfig.json ./
COPY src/ src/

USER nonroot

ENTRYPOINT ["/usr/local/bin/bun", "src/index.ts"]
