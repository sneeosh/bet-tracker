import { Hono } from 'hono';
import type { Env } from '../types';
import { getPlayerByPhone } from '../db/queries';
import { twimlResponse, parseTwilioBody, validateTwilioWebhook } from '../services/sms';
import { handleMessage } from '../services/chat';

const sms = new Hono<{ Bindings: Env }>();

sms.post('/sms/webhook', async (c) => {
  // Validate Twilio signature in production
  if (c.env.ENVIRONMENT !== 'development') {
    const isValid = await validateTwilioWebhook(c.req.raw, c.env);
    if (!isValid) {
      return c.text('Forbidden', 403);
    }
  }

  const formData = await c.req.formData();
  const { from, body } = parseTwilioBody(formData);

  const player = await getPlayerByPhone(c.env, from);
  if (!player) {
    return twimlResponse('Sorry, this number is not registered with any league.');
  }

  const response = await handleMessage(c.env, player, body);
  return twimlResponse(response);
});

export default sms;
