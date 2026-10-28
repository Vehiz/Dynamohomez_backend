# DynamoHomez Backend (NestJS)

This backend is the primary application backend (NestJS + PostgreSQL + Redis).

## Scripts

- `npm run dev` - run with watch mode
- `npm run build` - compile TypeScript to `dist`
- `npm run start` - run compiled output
- `npm run type-check` - TypeScript check

## API Reference

- See `backend/API.md` for current endpoint contracts.

## Quick start

1. Copy `.env.example` to `.env`
2. Fill secrets and database URLs
3. Install dependencies: `npm install`
4. Run: `npm run dev`

## Local Runbook

### 1) Start PostgreSQL and Redis

Using Docker (recommended):

```bash
docker run --name dh-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=dynamohomez -p 5432:5432 -d postgres:16
docker run --name dh-redis -p 6379:6379 -d redis:7
```

### 2) Configure environment

Copy `.env.example` to `.env` and set values at minimum:

- `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/dynamohomez`
- `REDIS_URL=redis://localhost:6379`
- `JWT_ACCESS_SECRET` (20+ chars)
- `JWT_REFRESH_SECRET` (20+ chars)

### 3) Run the backend

```bash
npm install
npm run dev
```

Backend base URL:

- `http://localhost:4000/api`

### 4) Smoke test

```bash
curl http://localhost:4000/api/health
```

Expected: `success: true` with database/redis service statuses.

### 5) Frontend integration

In root `.env`:

```env
VITE_BACKEND_API_URL=http://localhost:4000/api
```

Then start frontend from project root:

```bash
npm run dev
```

## Current status

- Core NestJS app bootstrap
- Config validation
- Health endpoint
- Auth endpoints with PostgreSQL + Redis persistence
- Platform compatibility endpoints for listings/profiles/requests/users/stats
- Engagement endpoints for messages/verification/reviews/reports/notifications
