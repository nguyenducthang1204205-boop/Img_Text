// Đăng nhập trên Cloudflare: mật khẩu băm bằng PBKDF2 (Web Crypto), phiên lưu trong D1.

// 100.000 là số vòng lặp PBKDF2 tối đa Cloudflare Workers cho phép
const ITERATIONS = 100000;
const SESSION_TTL = 60 * 60 * 8; // 8 giờ (giây)
const COOKIE = 'session';

const enc = new TextEncoder();
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => new Uint8Array(hex.match(/../g).map((h) => parseInt(h, 16)));

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERATIONS}$${toHex(salt)}$${toHex(await pbkdf2(password, salt, ITERATIONS))}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, iter, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'pbkdf2') return false;
  const actual = new Uint8Array(await pbkdf2(password, fromHex(saltHex), Number(iter)));
  const expected = fromHex(hashHex);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i]; // so sánh thời gian cố định
  return diff === 0;
}

// Dùng khi không có tài khoản, để thời gian phản hồi giống như khi sai mật khẩu
export const DUMMY_HASH = `pbkdf2$${ITERATIONS}$${'00'.repeat(16)}$${'00'.repeat(32)}`;

async function sha256Hex(text) {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

function readCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

function cookie(value, maxAge) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export async function createSession(env, userId) {
  const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const now = Math.floor(Date.now() / 1000);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
    env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(
      await sha256Hex(token),
      userId,
      now + SESSION_TTL
    ),
  ]);
  return cookie(token, SESSION_TTL);
}

export async function destroySession(request, env) {
  const token = readCookie(request, COOKIE);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
  return cookie('', 0);
}

// Trả về { id, username } nếu phiên còn hạn, ngược lại null
export async function getUser(request, env) {
  const token = readCookie(request, COOKIE);
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  return env.DB.prepare(
    `SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`
  )
    .bind(await sha256Hex(token), Math.floor(Date.now() / 1000))
    .first();
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

export async function readCredentials(request) {
  let body = {};
  try {
    body = await request.json();
  } catch {}
  return { username: String(body.username || '').trim(), password: String(body.password || '') };
}
