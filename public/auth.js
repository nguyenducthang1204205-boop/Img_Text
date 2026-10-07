const form = document.getElementById('authForm');
const msg = document.getElementById('msg');
const submitBtn = document.getElementById('submitBtn');
const confirmField = document.getElementById('confirmField');
const passwordInput = document.getElementById('password');
let mode = 'login';

function setMode(next) {
  mode = next;
  const isLogin = mode === 'login';
  document.getElementById('title').textContent = isLogin ? 'Đăng nhập' : 'Tạo tài khoản';
  submitBtn.textContent = isLogin ? 'Đăng nhập' : 'Đăng ký';
  document.getElementById('switchText').textContent = isLogin ? 'Chưa có tài khoản?' : 'Đã có tài khoản?';
  document.getElementById('switchLink').textContent = isLogin ? 'Đăng ký' : 'Đăng nhập';
  confirmField.hidden = isLogin;
  passwordInput.autocomplete = isLogin ? 'current-password' : 'new-password';
  msg.textContent = '';
}

document.getElementById('switchLink').addEventListener('click', () => {
  setMode(mode === 'login' ? 'register' : 'login');
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  msg.textContent = '';
  const username = document.getElementById('username').value.trim();
  const password = passwordInput.value;

  if (mode === 'register' && password !== document.getElementById('confirm').value) {
    msg.textContent = 'Mật khẩu nhập lại không khớp';
    return;
  }

  submitBtn.disabled = true;
  try {
    const res = await fetch(mode === 'login' ? '/api/login' : '/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Có lỗi xảy ra');
    window.location.href = '/app/';
  } catch (err) {
    msg.textContent = err.message;
  } finally {
    submitBtn.disabled = false;
  }
});
