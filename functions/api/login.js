import { DUMMY_HASH, createSession, json, readCredentials, verifyPassword } from '../../lib/auth.js';

export async function onRequestPost({ request, env }) {
  const { username, password } = await readCredentials(request);
  const user = await env.DB.prepare('SELECT id, password_hash FROM users WHERE username = ?').bind(username).first();
  const ok = await verifyPassword(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) return json({ error: 'Sai tên đăng nhập hoặc mật khẩu' }, 401);

  const setCookie = await createSession(env, user.id);
  return json({ ok: true }, 200, { 'Set-Cookie': setCookie });
}
