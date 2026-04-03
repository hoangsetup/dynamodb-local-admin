FROM node:24-alpine AS build

WORKDIR /build

COPY package*.json ./
RUN npm ci --prefer-offline --no-audit --ignore-scripts

COPY bin bin/
COPY lib lib/
COPY styles styles/
COPY views views/
COPY public public/
COPY rollup.config.ts .
COPY tsconfig.json .
COPY tailwind.config.js .

RUN npm run build

FROM eclipse-temurin:21-jre-jammy

RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates curl xz-utils && \
    NODE_VERSION=24.13.0 && \
    ARCH=$(dpkg --print-architecture) && \
    curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${ARCH}.tar.xz" | tar -xJ -C /usr/local --strip-components=1 && \
    npm -g install npm@11 && \
    npm cache clean --force && \
    curl -o /usr/local/bin/caddy "https://caddyserver.com/api/download?os=linux&arch=${ARCH}" && \
    chmod +x /usr/local/bin/caddy && \
    mkdir -p /usr/lib && \
    cd /usr/lib && \
    curl -fsSL https://d1ni2b6xgvw0s0.cloudfront.net/v2.x/dynamodb_local_latest.tar.gz | tar xz && \
    apt-get remove -y curl xz-utils && \
    apt-get autoremove -y && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/* /root/.npm

WORKDIR /opt/dynamodb-admin

COPY --from=build /build/dist dist/
COPY --from=build /build/public public/
COPY --from=build /build/views views/
COPY package*.json ./

RUN npm install --omit=dev --prefer-offline --no-audit --ignore-scripts

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
#!/bin/bash
set -m

mkdir -p /var/lib/dynamodb

# Start DynamoDB Local
java -Djava.library.path=/usr/lib/DynamoDBLocal_lib \\
     -jar /usr/lib/DynamoDBLocal.jar \\
     -port 8002 -sharedDb -dbPath /var/lib/dynamodb \\
     -disableTelemetry &

# Start dynamodb-admin
cd /opt/dynamodb-admin
DYNAMO_ENDPOINT=http://localhost:8002/ node dist/dynamodb-admin.js &

# Execute Caddy as the foreground process
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
EOF

RUN chmod +x /start.sh

VOLUME /var/lib/dynamodb

# Expose ports: 8000 (proxy), 8001 (admin), 8002 (dynamodb)
EXPOSE 8000 8001 8002

CMD ["/start.sh"]
