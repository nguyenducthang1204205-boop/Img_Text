import { getUser, json } from '../../lib/auth.js';

export async function onRequestGet({ request, env }) {
  const user = await getUser(request, env);
  return user ? json({ username: user.username }) : json({ error: 'Bạn cần đăng nhập' }, 401);
}
