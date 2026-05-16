FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    osmium-tool ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /data
ENTRYPOINT ["osmium"]
