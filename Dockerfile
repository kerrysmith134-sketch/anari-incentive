FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json tsconfig.json vitest.config.ts ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
COPY examples ./examples
COPY fixtures ./fixtures
COPY db ./db

RUN npm ci && npm run web:build

USER node

EXPOSE 3000 3100
CMD ["npm", "run", "dev"]
