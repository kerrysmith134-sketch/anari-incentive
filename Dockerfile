# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json vitest.config.ts ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
COPY examples ./examples
COPY fixtures ./fixtures
COPY db ./db
RUN npm ci && npm run web:build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json tsconfig.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
COPY examples ./examples
COPY fixtures ./fixtures
COPY db ./db
COPY --from=build /app/apps/web/dist ./apps/web/dist
RUN npm ci --omit=dev \
 && npm install -g npm@latest
USER node
EXPOSE 3000 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT??3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "run", "start"]
