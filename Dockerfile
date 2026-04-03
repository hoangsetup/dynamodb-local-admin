FROM node:24-alpine AS build

WORKDIR /build

COPY package*.json ./
RUN npm ci --prefer-offline --no-audit --ignore-scripts

COPY . .
RUN npm run build

FROM eclipse-temurin:21-jre-jammy

ENV NODE_VERSION=24.14.1 \
    DDB_PATH=/app/data/dynamodb

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ca-certificates curl xz-utils dumb-init && \
    \
    ARCH=$(dpkg --print-architecture) && \
    if [ "$ARCH" = "amd64" ]; then NODE_ARCH="x64"; fi && \
    if [ "$ARCH" = "arm64" ]; then NODE_ARCH="arm64"; fi && \
    \
    # Install Node.js (binary) \
    curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz" \
      | tar -xJ -C /usr/local --strip-components=1 && \
    \
    npm install -g npm@11 && \
    npm cache clean --force && \
    \
    # Install Caddy \
    curl -fS -o /usr/local/bin/caddy "https://caddyserver.com/api/download?os=linux&arch=${ARCH}" && \
    chmod +x /usr/local/bin/caddy && \
    \
    # Install DynamoDB Local \
    mkdir -p /usr/lib/dynamodb && \
    curl -fsSL https://d1ni2b6xgvw0s0.cloudfront.net/v2.x/dynamodb_local_latest.tar.gz \
      | tar xz -C /usr/lib/dynamodb && \
    \
    # Cleanup \
    apt-get purge -y xz-utils && \
    apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/* /root/.npm

WORKDIR /opt/dynamodb-admin

COPY --from=build /build/dist dist/
COPY --from=build /build/public public/
COPY --from=build /build/views views/
COPY package*.json ./

RUN npm ci --omit=dev --prefer-offline --no-audit --ignore-scripts && \
    npm cache clean --force

COPY <<EOF /etc/caddy/Caddyfile
:8000 {
    @dynamodb {
        header_regexp X-Amz-Target (?i)dynamo
    }
    handle @dynamodb {
        reverse_proxy localhost:8002
    }
    handle {
        reverse_proxy localhost:8001
    }
}
EOF

COPY <<EOF /start.sh
#!/bin/sh
set -e

mkdir -p /app/data/dynamodb

# Start DynamoDB Local
java -Djava.library.path=/usr/lib/dynamodb/DynamoDBLocal_lib \\
     -jar /usr/lib/dynamodb/DynamoDBLocal.jar \\
     -port 8002 \\
     -sharedDb \\
     -dbPath /app/data/dynamodb \\
     -disableTelemetry &

# Start dynamodb-admin
cd /opt/dynamodb-admin
DYNAMO_ENDPOINT=http://localhost:8002/ node dist/dynamodb-admin.js &

# Execute Caddy as the foreground process
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
EOF

RUN chmod +x /start.sh

VOLUME /app/data/dynamodb

# 8000 (proxy), 8001 (admin), 8002 (dynamodb)
EXPOSE 8000 8001 8002

ENTRYPOINT ["dumb-init", "/start.sh"]

HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
CMD curl -fs http://localhost:8000/ || exit 1
