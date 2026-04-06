import type { Env } from '../types';

/**
 * Send an SMS via the Twilio REST API using fetch.
 */
export async function sendSms(env: Env, to: string, body: string): Promise<void> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`;
  const auth = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);

  const params = new URLSearchParams();
  params.set('To', to);
  params.set('From', env.TWILIO_PHONE_NUMBER);
  params.set('Body', body);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Twilio SMS failed (${response.status}): ${error}`);
  }
}

/**
 * Send the same SMS message to multiple players.
 */
export async function broadcastSms(
  env: Env,
  players: { phone: string }[],
  body: string,
): Promise<void> {
  await Promise.all(players.map((player) => sendSms(env, player.phone, body)));
}

/**
 * Validate an incoming Twilio webhook signature using HMAC-SHA1.
 *
 * Twilio signs requests by computing HMAC-SHA1 of the full request URL
 * concatenated with the sorted POST parameter key/value pairs, using
 * the auth token as the key.
 */
export async function validateTwilioWebhook(
  request: Request,
  env: Env,
): Promise<boolean> {
  const signature = request.headers.get('X-Twilio-Signature');
  if (!signature) {
    return false;
  }

  // Clone so the body can still be read downstream
  const cloned = request.clone();
  const formData = await cloned.formData();

  // Build the data string: URL + sorted params concatenated as key/value pairs
  const url = request.url;
  const params: [string, string][] = [];
  formData.forEach((value, key) => {
    params.push([key, String(value)]);
  });
  params.sort((a, b) => a[0].localeCompare(b[0]));

  let data = url;
  for (const [key, value] of params) {
    data += key + value;
  }

  // Compute HMAC-SHA1 using the Web Crypto API
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(env.TWILIO_AUTH_TOKEN),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );

  const signatureBytes = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  const expectedSignature = btoa(
    String.fromCharCode(...new Uint8Array(signatureBytes)),
  );

  return expectedSignature === signature;
}

/**
 * Extract the From phone number and Body text from a Twilio webhook POST.
 */
export function parseTwilioBody(formData: FormData): { from: string; body: string } {
  return {
    from: (formData.get('From') as string) ?? '',
    body: (formData.get('Body') as string) ?? '',
  };
}

/**
 * Return a TwiML XML response for replying to an incoming SMS.
 */
export function twimlResponse(message: string): Response {
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Response>',
    `  <Message>${escapeXml(message)}</Message>`,
    '</Response>',
  ].join('\n');

  return new Response(xml, {
    headers: { 'Content-Type': 'text/xml' },
  });
}

/**
 * Escape special characters for safe inclusion in XML content.
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
