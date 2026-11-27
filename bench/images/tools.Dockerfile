ARG NODE_IMAGE
FROM ${NODE_IMAGE} AS tools
WORKDIR /opt/bench
COPY package*.json ./
RUN npm ci --no-audit --no-fund && npm cache clean --force
ENV PATH=/opt/bench/node_modules/.bin:$PATH

FROM tools AS browser
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/chromium
RUN playwright install --with-deps chromium && rm -rf /var/lib/apt/lists/*
EXPOSE 3000
HEALTHCHECK --interval=1s --timeout=3s --retries=20 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/json').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["playwright", "run-server", "--host", "0.0.0.0", "--port", "3000"]

FROM tools AS agent
ENV CODEX_HOME=/home/node/.codex
RUN mkdir -p /home/node/.codex && chown node:node /home/node/.codex
USER node
HEALTHCHECK --interval=1s --timeout=5s --retries=20 CMD ["sh", "-c", "codex --version && playwright-mcp --version"]
CMD ["sleep", "infinity"]
