const form = document.getElementById('authForm');
const msg = document.getElementById('msg');
const submitBtn = document.getElementById('submitBtn');
const confirmField = document.getElementById('confirmField');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const tabLogin = document.getElementById('tabLogin');
const tabRegister = document.getElementById('tabRegister');
let mode = 'login';

function setMode(next) {
  mode = next;
  const isLogin = mode === 'login';
  document.getElementById('title').textContent = isLogin ? 'Chào mừng trở lại' : 'Tạo tài khoản mới';
  document.getElementById('subtitle').textContent = isLogin
    ? 'Đăng nhập để chuyển ảnh câu hỏi thành file Word.'
    : 'Miễn phí, chỉ cần tên đăng nhập và mật khẩu.';
  submitBtn.textContent = isLogin ? 'Đăng nhập' : 'Tạo tài khoản';
  document.getElementById('switchText').textContent = isLogin ? 'Chưa có tài khoản?' : 'Đã có tài khoản?';
  document.getElementById('switchLink').textContent = isLogin ? 'Đăng ký miễn phí' : 'Đăng nhập';
  tabLogin.setAttribute('aria-pressed', isLogin);
  tabRegister.setAttribute('aria-pressed', !isLogin);
  confirmField.hidden = isLogin;
  document.getElementById('userHelp').hidden = isLogin;
  document.getElementById('pwHelp').hidden = isLogin;
  passwordInput.autocomplete = isLogin ? 'current-password' : 'new-password';
  msg.textContent = '';
}

tabLogin.addEventListener('click', () => setMode('login'));
tabRegister.addEventListener('click', () => setMode('register'));
document.getElementById('switchLink').addEventListener('click', () => {
  setMode(mode === 'login' ? 'register' : 'login');
  usernameInput.focus();
});

// Hiện / ẩn mật khẩu
const pwToggle = document.getElementById('pwToggle');
pwToggle.addEventListener('click', () => {
  const show = passwordInput.type === 'password';
  passwordInput.type = show ? 'text' : 'password';
  document.getElementById('confirm').type = show ? 'text' : 'password';
  pwToggle.setAttribute('aria-pressed', show);
  pwToggle.setAttribute('aria-label', show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu');
});

function showError(text, field) {
  msg.textContent = text;
  if (field) field.focus();
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  msg.textContent = '';
  const username = usernameInput.value.trim();
  const password = passwordInput.value;

  if (!username) return showError('Hãy nhập tên đăng nhập', usernameInput);
  if (!password) return showError('Hãy nhập mật khẩu', passwordInput);
  if (mode === 'register') {
    if (!/^[a-zA-Z0-9_.]{3,32}$/.test(username)) {
      return showError('Tên đăng nhập 3–32 ký tự, chỉ gồm chữ, số, "_" hoặc "."', usernameInput);
    }
    if (password.length < 6) return showError('Mật khẩu phải có ít nhất 6 ký tự', passwordInput);
    if (password !== document.getElementById('confirm').value) {
      return showError('Mật khẩu nhập lại không khớp', document.getElementById('confirm'));
    }
  }

  const label = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span class="spinner" aria-hidden="true"></span> Đang xử lý…';
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
    showError(err.message);
    submitBtn.disabled = false;
    submitBtn.textContent = label;
  }
});
