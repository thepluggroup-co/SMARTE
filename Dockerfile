FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
ENV TZ=Africa/Douala
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY tsconfig.json ./
COPY migrations ./migrations
COPY scripts ./scripts
COPY src ./src
COPY public ./public
RUN mkdir -p /medias && chown node:node /medias
USER node
EXPOSE 3000
CMD ["node", "--import", "tsx", "src/index.ts"]
