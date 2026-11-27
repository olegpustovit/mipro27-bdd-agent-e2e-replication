ARG PAY_DEPS
FROM ${PAY_DEPS} AS frontend
COPY source/ ./
COPY prepare-pay.mjs ./
RUN yarn predev:cognito:ci && node prepare-pay.mjs && yarn vite build

FROM ${PAY_DEPS}
COPY source/ ./
COPY --from=frontend /app/build/ build/
COPY --from=frontend /app/aws-exports-es5.js ./
COPY --from=frontend /app/src/aws-exports.js src/aws-exports.js
COPY --from=frontend /app/backend/app.ts backend/app.ts
ENV NODE_ENV=development TS_NODE_TRANSPILE_ONLY=true
RUN cp data/database-seed.json data/database.json && chown node:node data data/database.json
USER node
EXPOSE 3000
HEALTHCHECK --interval=1s --timeout=2s --retries=30 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health').then(async r=>{if(!r.ok || await r.text() !== 'ready')process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["./node_modules/.bin/ts-node", "-P", "tsconfig.tsnode.json", "--files", "backend/app.ts"]
