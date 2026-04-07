import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './types';
import api from './routes/api';
import admin from './routes/admin';
import sms from './routes/sms';
import { handleSundayMorning, handleDailyResultCheck, handlePickReminder } from './services/scheduler';

const app = new Hono<{ Bindings: Env }>();

// CORS for web admin
app.use('/api/*', cors());

// Health check
app.get('/', (c) => c.json({ status: 'ok', service: 'bet-tracker' }));

// Mount routes
app.route('/', api);
app.route('/', admin);
app.route('/', sms);

// Export for Cloudflare Workers
export default {
  fetch: app.fetch,

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const hour = new Date(event.scheduledTime).getUTCHours();
    const dayOfWeek = new Date(event.scheduledTime).getUTCDay();

    if (dayOfWeek === 0 && hour === 15) {
      // Sunday 10am CT (15:00 UTC) — standings + new week
      ctx.waitUntil(handleSundayMorning(env));
    }

    if (hour === 11) {
      // Daily 6am CT (11:00 UTC) — check game results
      ctx.waitUntil(handleDailyResultCheck(env));
      // Also check if reminders need to go out
      ctx.waitUntil(handlePickReminder(env));
    }
  },
};
