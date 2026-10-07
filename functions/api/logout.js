import { destroySession, json } from '../../lib/auth.js';

export async function onRequestPost({ request, env }) {
  return json({ ok: true }, 200, { 'Set-Cookie': await destroySession(request, env) });
}
