# Task 016: Generate Docker Dev Environment

## Priority

P0

## Summary

Generate `docker-compose.dev.yml` and `Dockerfile.dev` in planning output. Agents running on different machines (different Node versions, OS libraries) hit environment drift. Docker-first development eliminates "works on my machine."

## Problem

During dogfooding, Ice had Node 22, Lava possibly 18 or 20. npm versions differ. Prisma binary architecture mismatches. These cause subtle failures that waste debugging time.

## Solution

Generate in output directory:

**docker-compose.dev.yml:**
```yaml
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile.dev
    volumes:
      - ./:/app
      - /app/node_modules
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgresql://dev:dev@db:5432/app_dev
    depends_on:
      db:
        condition: service_healthy
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: dev
      POSTGRES_PASSWORD: dev
      POSTGRES_DB: app_dev
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U dev"]
      interval: 5s
      timeout: 3s
      retries: 10
```

**Dockerfile.dev:**
```dockerfile
FROM node:20-slim
WORKDIR /app
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm install
COPY . .
RUN npx prisma generate
CMD ["npm", "run", "dev"]
```

## Files to Modify

- `scripts/bootstrap-plan.js` — Add Docker file generation
- Add template files or inline generation

## Acceptance Criteria

- [ ] `docker compose -f docker-compose.dev.yml up` starts app + db
- [ ] Hot reload works (volumes mounted)
- [ ] Node version pinned (consistent across agents)
- [ ] Makefile updated: `make dev` uses Docker
