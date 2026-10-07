import { createSession, hashPassword, json, readCredentials } from '../../lib/auth.js';

export async function onRequestPost({ request, env }) {
  const { username, password } = await readCredentials(request);
  if (!/^[a-zA-Z0-9_.]{3,32}$/.test(username)) {
    return json({ error: 'Tên đăng nhập 3–32 ký tự, chỉ gồm chữ, số, "_" hoặc "."' }, 400);
  }
  if (password.length < 6) return json({ error: 'Mật khẩu phải có ít nhất 6 ký tự' }, 400);
  if (password.length > 200) return json({ error: 'Mật khẩu quá dài' }, 400);

  const exists = await env.DB.prepare('SELECT 1 FROM users WHERE username = ?').bind(username).first();
  if (exists) return json({ error: 'Tên đăng nhập đã tồn tại' }, 409);

  const result = await env.DB.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
    .bind(username, await hashPassword(password))
    .run();
  const setCookie = await createSession(env, result.meta.last_row_id);
  return json({ ok: true }, 200, { 'Set-Cookie': setCookie });
}
