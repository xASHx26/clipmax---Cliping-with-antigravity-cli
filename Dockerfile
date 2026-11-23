# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS whisper-build
ARG WHISPER_VERSION=1.8.2
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl cmake build-essential && rm -rf /var/lib/apt/lists/*
WORKDIR /tmp/whisper
RUN curl -fL --retry 3 "https://github.com/ggml-org/whisper.cpp/archive/refs/tags/v${WHISPER_VERSION}.tar.gz" \
      | tar -xz --strip-components=1 \
    && cmake -S . -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
      -DGGML_NATIVE=OFF -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON \
    && cmake --build build --target whisper-cli -j 2 \
    && mkdir -p /opt/whisper/bin /opt/whisper/licenses \
    && cp build/bin/whisper-cli /opt/whisper/bin/ \
    && cp LICENSE /opt/whisper/licenses/whisper-cpp.txt

FROM node:22-bookworm-slim AS assets
ARG YTDLP_VERSION=2026.10.26
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl python3 python3-venv && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY scripts/setup-face-model.mjs scripts/setup-face-model.mjs
RUN node scripts/setup-face-model.mjs
RUN python3 -m venv /opt/ytdlp \
    && /opt/ytdlp/bin/pip install --no-cache-dir "yt-dlp[default]==${YTDLP_VERSION}"
RUN mkdir -p /opt/models /opt/licenses \
    && curl -fL --retry 3 https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin \
      -o /opt/models/ggml-base-q5_1.bin \
    && curl -fL --retry 3 https://raw.githubusercontent.com/openai/whisper/main/LICENSE -o /opt/licenses/whisper-model.txt \
    && curl -fL --retry 3 https://raw.githubusercontent.com/ggml-org/whisper.cpp/v1.8.2/samples/jfk.wav -o /opt/models/speech-check.wav
# Google's installer verifies the CLI payload against its SHA-512 release manifest.
# The vendor's CLI channel is rolling; npm, yt-dlp and whisper.cpp are versioned above.
RUN curl -fL --retry 3 https://antigravity.google/cli/install.sh -o /tmp/install-agy.sh \
    && bash /tmp/install-agy.sh --dir /opt/agy

FROM node:22-bookworm-slim AS runtime
LABEL org.opencontainers.image.title="Clipmax Studio" \
      org.opencontainers.image.description="Antigravity-powered clip editing, captions and publishing" \
      org.opencontainers.image.source="https://github.com/xASHx26/clipmax---Cliping-with-antigravity-cli"
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg fonts-dejavu-core python3 ca-certificates libgomp1 libsecret-1-0 \
    bubblewrap ripgrep git openssh-client && rm -rf /var/lib/apt/lists/*
RUN printf '%s\n' '--js-runtimes node:/usr/local/bin/node' > /etc/yt-dlp.conf
WORKDIR /app
COPY --from=assets /app/node_modules ./node_modules
COPY --from=assets /app/bin/face ./bin/face
COPY --from=assets /opt/ytdlp /opt/ytdlp
COPY --from=assets /opt/models /opt/models
COPY --from=assets /opt/licenses /opt/licenses
COPY --from=assets --chown=node:node /opt/agy/ /home/node/.local/bin/
COPY --from=whisper-build /opt/whisper /opt/whisper
COPY package.json package-lock.json server.mjs README.md ./
COPY lib ./lib
COPY public ./public
COPY test ./test
COPY docker ./docker
COPY scripts/verify-container.mjs ./scripts/verify-container.mjs
RUN mkdir -p /var/lib/clipmax /home/node/.gemini /home/node/.config /home/node/.cache \
    && chown -R node:node /var/lib/clipmax /home/node
ENV NODE_ENV=production PORT=4310 CLIPMAX_BIND_HOST=0.0.0.0 \
    CLIPMAX_DATA_DIR=/var/lib/clipmax/projects \
    CLIPMAX_SETTINGS_DIR=/var/lib/clipmax/settings \
    FFMPEG_PATH=/usr/bin/ffmpeg YTDLP_PATH=/opt/ytdlp/bin/yt-dlp \
    WHISPER_PATH=/opt/whisper/bin/whisper-cli \
    WHISPER_MODEL_PATH=/opt/models/ggml-base-q5_1.bin \
    AGY_PATH=/home/node/.local/bin/agy \
    PATH=/home/node/.local/bin:/opt/ytdlp/bin:$PATH
USER node
EXPOSE 4310
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
ENTRYPOINT ["node", "docker/entrypoint.mjs"]
CMD ["node", "server.mjs"]
