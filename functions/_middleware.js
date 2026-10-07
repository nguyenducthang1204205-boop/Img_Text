import { getUser } from '../lib/auth.js';

// Trang chủ điều hướng theo trạng thái đăng nhập; mọi thứ trong /app/ chỉ dành cho người đã đăng nhập
export async function onRequest({ request, env, next }) {
  const url = new URL(request.url);

  if (url.pathname === '/') {
    const user = await getUser(request, env);
    return Response.redirect(new URL(user ? '/app/' : '/login', url), 302);
  }

  if (url.pathname === '/app' || url.pathname.startsWith('/app/')) {
    if (!(await getUser(request, env))) return Response.redirect(new URL('/login', url), 302);
    const res = await next();
    const out = new Response(res.body, res);
    out.headers.set('Cache-Control', 'private, no-store');
    return out;
  }

  return next();
}
