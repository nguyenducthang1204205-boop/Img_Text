// Cloudflare Worker: API đăng nhập + chặn /app/ khi chưa đăng nhập.
// Các file tĩnh trong public/ do Cloudflare phục vụ trực tiếp (binding ASSETS).
import {
  DUMMY_HASH,
  createSession,
  destroySession,
  getUser,
  hashPassword,
  json,
  readCredentials,
  verifyPassword,
} from '../lib/auth.js';

async function register(request, env) {
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
  return json({ ok: true }, 200, { 'Set-Cookie': await createSession(env, result.meta.last_row_id) });
}

async function login(request, env) {
  const { username, password } = await readCredentials(request);
  const user = await env.DB.prepare('SELECT id, password_hash FROM users WHERE username = ?').bind(username).first();
  const ok = await verifyPassword(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) return json({ error: 'Sai tên đăng nhập hoặc mật khẩu' }, 401);
  return json({ ok: true }, 200, { 'Set-Cookie': await createSession(env, user.id) });
}

async function logout(request, env) {
  return json({ ok: true }, 200, { 'Set-Cookie': await destroySession(request, env) });
}

async function me(request, env) {
  const user = await getUser(request, env);
  return user ? json({ username: user.username }) : json({ error: 'Bạn cần đăng nhập' }, 401);
}

const ROUTES = {
  'POST /api/register': register,
  'POST /api/login': login,
  'POST /api/logout': logout,
  'GET /api/me': me,
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const handler = ROUTES[`${request.method} ${url.pathname}`];
    if (handler) return handler(request, env);
    if (url.pathname.startsWith('/api/')) return json({ error: 'Không tìm thấy' }, 404);

    // Trang chủ điều hướng theo trạng thái đăng nhập
    if (url.pathname === '/') {
      const user = await getUser(request, env);
      return Response.redirect(new URL(user ? '/app/' : '/login', url), 302);
    }

    // Mọi thứ trong /app/ chỉ dành cho người đã đăng nhập
    if (url.pathname === '/app' || url.pathname.startsWith('/app/')) {
      if (!(await getUser(request, env))) return Response.redirect(new URL('/login', url), 302);
      const res = await env.ASSETS.fetch(request);
      const out = new Response(res.body, res);
      out.headers.set('Cache-Control', 'private, no-store');
      return out;
    }

    return env.ASSETS.fetch(request);
  },
};
