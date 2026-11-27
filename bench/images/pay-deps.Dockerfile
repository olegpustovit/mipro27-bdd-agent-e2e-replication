ARG NODE_IMAGE
FROM ${NODE_IMAGE}
WORKDIR /app
ENV CYPRESS_INSTALL_BINARY=0 PUPPETEER_SKIP_DOWNLOAD=true HUSKY=0
COPY package.json yarn.lock .yarnrc ./
COPY patches/ patches/
RUN yarn install --frozen-lockfile --non-interactive && yarn cache clean
