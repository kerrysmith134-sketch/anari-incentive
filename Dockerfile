FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json tsconfig.json vitest.config.ts ./
COPY apps ./apps
COPY packages ./packages
COPY examples ./examples
COPY fixtures ./fixtures
COPY db ./db

RUN npm ci

EXPOSE 3000
CMD ["npm", "run", "dev"]
