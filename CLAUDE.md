# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Bet Tracker is an SMS-first application for tracking MLB season-long bets among a friend group. It uses Twilio for text messaging with a secondary web management interface. See `spec.md` for the full product specification.

### Core Concepts

- **Two season-long bets**: (1) performance against beginning-of-season over/under win totals, (2) most overall wins
- **Weekly game picking**: One rotating "bet manager" picks 3 MLB games each Sunday for the group; conversational SMS flow suggests games with starting pitcher info
- **Teams are permanently assigned** to each member by a league admin
- **Phone number validation**: only known numbers are accepted; one league admin invites users

### Key Integrations

- **Twilio** for SMS messaging (conversational flows for game picking, weekly updates, reminders)
- **MLB Stats API** (free, no auth) for schedules, win totals, starting pitchers, and game results
- **Cloudflare Workers AI** (`@cf/meta/llama-3.1-8b-instruct`) for parsing natural language SMS into structured intents
- **Web interface** for league admin setup (division selection, player/team assignment, user management)

## Architecture

- **Backend**: Cloudflare Worker using Hono framework (`src/index.ts` entry point)
- **Database**: Cloudflare D1 (SQLite). Schema in `migrations/0001_initial.sql`
- **Web admin**: React SPA in `web/`, proxies `/api` to the worker in dev
- **SMS flow**: Twilio webhook → `src/routes/sms.ts` → AI parsing → conversation state machine (idle → picking_games → making_picks)
- **Scheduled tasks**: Cron triggers in `src/services/scheduler.ts` — Sunday standings, daily result checks, pick reminders

### Key directories

- `src/db/queries.ts` — all D1 query functions
- `src/routes/` — Hono route handlers (api.ts for REST, sms.ts for Twilio webhook)
- `src/services/` — MLB API client, Twilio SMS, AI parsing, scheduled jobs
- `web/src/pages/` — React admin pages (Setup, Dashboard, Players)

## Commands

```bash
# Worker development
npm run dev              # Start local worker (wrangler dev)
npm run deploy           # Deploy to Cloudflare

# Database
npm run db:migrate       # Run migrations locally
npm run db:migrate:remote # Run migrations on production D1

# Web admin
npm run web:dev          # Start Vite dev server (port 5173, proxies /api to :8787)
npm run web:build        # Build for production

# Type checking
npx tsc --noEmit         # Check worker types
cd web && npx tsc --noEmit # Check web types
```

## Secrets (set via `wrangler secret put`)

- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` — Twilio credentials
- `ODDS_API_KEY` — for fetching preseason over/under lines
- `TWILIO_PHONE_NUMBER` — set in `wrangler.toml` vars
