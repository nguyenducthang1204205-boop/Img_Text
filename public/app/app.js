// Giao diện chính: thêm ảnh, trích xuất chữ, xử lý câu hỏi, xuất file Word / .txt, trộn đề, lịch sử.
const $ = (id) => document.getElementById(id);

const list = $('list');
const fileInput = $('fileInput');
const ocrBtn = $('ocrBtn');
const exportBtn = $('exportBtn');
const copyBtn = $('copyBtn');
const txtBtn = $('txtBtn');
const mixBtn = $('mixBtn');
const clearBtn = $('clearBtn');
const findBtn = $('findBtn');
const optNumber = $('optNumber');
const optFormat = $('optFormat');
const optDedupe = $('optDedupe');
const optThreshold = $('optThreshold');
const docTitle = $('docTitle');
const docFont = $('docFont');
const docSize = $('docSize');

// Mỗi phần tử: { id, name, file, url, text, state: 'pending' | 'working' | 'done' | 'error', error, pasted, el }
// Ảnh mở lại từ lịch sử không có file/url (lịch sử chỉ lưu chữ)
let items = [];
let busy = false;
let nextId = 1;
let lastText = ''; // nội dung sẽ xuất ra file, tính ở renderPreview

const STATE_LABEL = { pending: 'Chờ đọc', working: 'Đang đọc…', done: 'Đã đọc', error: 'Lỗi' };
// Số câu ở đầu dòng được in đậm: "Câu 1:", "Question 2:", "3."
const NUM_RE = /^((?:Câu|Question)\s+\d+[:.]|\d+\.)(\s.*|)$/;

const icon = (name) => `<svg class="ic" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const byId = (id) => items.find((i) => i.id === Number(id));

// ---------- Người dùng ----------
let username = '';
fetch('/api/me')
  .then((r) => (r.ok ? r.json() : Promise.reject()))
  .then((u) => {
    username = u.username;
    Sessions.setUser(u.username);
    $('who').textContent = u.username;
    $('avatar').textContent = u.username.charAt(0).toUpperCase();
  })
  .catch(() => (window.location.href = '/login'));

$('logoutBtn').addEventListener('click', async () => {
  if (busy && !(await confirmBox({ title: 'Đang trích xuất chữ', message: 'Đăng xuất bây giờ sẽ dừng việc đọc ảnh. Vẫn đăng xuất?', ok: 'Đăng xuất', danger: true }))) return;
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login';
});

// Tải sẵn bộ nhận dạng chữ ở nền để lúc bấm "Trích xuất chữ" chạy nhanh hơn
OCR.preload().catch((err) => console.warn('Chưa tải được bộ nhận dạng chữ:', err));

window.addEventListener('beforeunload', (e) => {
  if (busy) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// ---------- Giao diện sáng / tối ----------
$('themeBtn').addEventListener('click', () => {
  const root = document.documentElement;
  const current = root.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = current === 'dark' ? 'light' : 'dark';
  root.dataset.theme = next;
  try {
    localStorage.setItem('dt-theme', next);
  } catch {}
});

// ---------- Thông báo nhanh ----------
// action: { label, fn } – nút bấm trong thông báo (VD "Hoàn tác"); onClose(acted) chạy khi thông báo tắt
function toast(message, { type = 'success', action, onClose, timeout = 4500 } = {}) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  if (type === 'error') el.setAttribute('role', 'alert');
  el.innerHTML = `${icon(type === 'error' ? 'alert' : 'check')}<span class="toast-msg"></span>`;
  el.querySelector('.toast-msg').textContent = message;
  let acted = false;
  let closed = false;
  const dismiss = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    el.classList.remove('show');
    setTimeout(() => el.remove(), 250);
    if (onClose) onClose(acted);
  };
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'toast-action';
    b.textContent = action.label;
    b.addEventListener('click', () => {
      acted = true;
      action.fn();
      dismiss();
    });
    el.appendChild(b);
  }
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'toast-x';
  x.setAttribute('aria-label', 'Đóng thông báo');
  x.innerHTML = icon('x');
  x.addEventListener('click', dismiss);
  el.appendChild(x);
  $('toasts').appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  const timer = setTimeout(dismiss, timeout);
  return dismiss;
}

function setStatus(text) {
  $('status').textContent = text;
}

// ---------- Hộp thoại ----------
document.querySelectorAll('dialog').forEach((dlg) => {
  // Bấm ra ngoài khung để đóng
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) dlg.close();
  });
  dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => dlg.close()));
});

function confirmBox({ title, message, ok = 'Đồng ý', danger = false }) {
  const dlg = $('confirmDialog');
  $('confirmTitle').textContent = title;
  $('confirmMsg').textContent = message;
  const okBtn = $('confirmOk');
  okBtn.textContent = ok;
  okBtn.className = 'btn ' + (danger ? 'btn-danger' : 'btn-primary');
  dlg.returnValue = '';
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
    dlg.showModal();
    okBtn.focus();
  });
}

// ---------- Chọn / kéo thả ảnh ----------
const dropzone = $('dropzone');
dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});
fileInput.addEventListener('change', () => {
  addFiles(fileInput.files);
  fileInput.value = '';
});

// Thả ảnh vào bất kỳ đâu trên trang (kéo để đổi thứ tự ảnh thì không có file nên không bị nhầm)
let dragDepth = 0;
const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
const endFileDrag = () => {
  dragDepth = 0;
  document.body.classList.remove('dropping');
};
document.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  dragDepth++;
  document.body.classList.add('dropping');
});
document.addEventListener('dragleave', (e) => {
  if (hasFiles(e) && --dragDepth <= 0) endFileDrag();
});
document.addEventListener('dragover', (e) => {
  if (hasFiles(e)) e.preventDefault();
});
document.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  endFileDrag();
  const added = addFiles(e.dataTransfer.files);
  if (added.length) toast(`Đã thêm ${added.length} ảnh`);
});

// ---------- Dán ảnh: nút "Dán ảnh", ô dán, hoặc Ctrl+V ở bất kỳ đâu trên trang ----------
const pasteZone = $('pasteZone');
const pasteTarget = $('pasteTarget');
let pasteCount = 0;

// Ảnh dán từ bộ nhớ tạm thường đều tên "image.png": đặt tên riêng cho dễ phân biệt
function namePasted(blob) {
  const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
  return new File([blob], `anh-dan-${++pasteCount}.${ext}`, { type: blob.type });
}

function addPasted(blobs) {
  const added = addFiles(blobs.map(namePasted));
  added.forEach((item) => (item.pasted = true));
  renderPasteInfo();
  const names = added.map((i) => i.name).join(', ');
  setStatus(`Đã dán ${names} – danh sách có ${items.length} ảnh. Copy ảnh khác rồi dán tiếp, hoặc bấm "Trích xuất chữ".`);
  // Nháy viền để thấy rõ mỗi lần dán, kể cả khi dán liên tiếp
  pasteZone.classList.remove('ok');
  void pasteZone.offsetWidth;
  pasteZone.classList.add('ok');
  clearTimeout(addPasted.timer);
  addPasted.timer = setTimeout(() => pasteZone.classList.remove('ok'), 1200);
}

// Ảnh thu nhỏ của các ảnh đã dán ngay trong ô dán, để thấy ảnh mới xuất hiện mỗi lần dán
const MAX_THUMBS = 8;
function renderPasteInfo() {
  const pasted = items.filter((i) => i.pasted);
  const thumbs = $('pasteThumbs');
  $('pasteInfo').hidden = pasted.length === 0;
  $('pasteCountText').textContent = `Đã dán ${pasted.length} ảnh – dán tiếp được`;
  thumbs.innerHTML = '';
  pasted.slice(-MAX_THUMBS).forEach((item) => {
    const img = document.createElement('img');
    img.src = item.url;
    img.alt = item.name;
    img.title = `${item.name} – bấm để xem trong danh sách`;
    img.addEventListener('click', () => item.el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    thumbs.appendChild(img);
  });
  if (pasted.length > MAX_THUMBS) {
    const more = document.createElement('span');
    more.className = 'more';
    more.textContent = `+${pasted.length - MAX_THUMBS}`;
    thumbs.prepend(more);
  }
}

const NO_IMAGE_MSG = 'Bộ nhớ tạm không có ảnh. Hãy copy ảnh (chuột phải → Sao chép hình ảnh) hoặc chụp màn hình rồi dán lại.';

document.addEventListener('paste', (e) => {
  const dt = e.clipboardData;
  if (!dt) return;
  let files = [...dt.files];
  if (!files.length) files = [...dt.items].filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter(Boolean);
  files = files.filter((f) => f.type.startsWith('image/'));
  if (files.length) {
    e.preventDefault(); // không chèn ảnh vào ô chữ đang gõ
    addPasted(files);
  } else if (pasteTarget.contains(e.target)) {
    e.preventDefault();
    setStatus(NO_IMAGE_MSG);
  }
});

// Ô dán chỉ để nhận lệnh dán, luôn giữ trống
pasteTarget.addEventListener('input', () => (pasteTarget.innerHTML = ''));

// Nút "Dán ảnh": đọc thẳng bộ nhớ tạm (trình duyệt có thể hỏi quyền lần đầu).
// Trình duyệt không hỗ trợ hoặc bị từ chối thì chuyển sang ô dán để người dùng tự dán.
$('pasteBtn').addEventListener('click', async () => {
  const askManual = () => {
    pasteTarget.focus();
    setStatus('Trình duyệt không cho đọc bộ nhớ tạm trực tiếp. Hãy nhấn Ctrl+V, hoặc trên điện thoại nhấn giữ vào ô bên dưới nút rồi chọn "Dán".');
  };
  if (!navigator.clipboard || !navigator.clipboard.read) return askManual();
  try {
    const blobs = [];
    for (const item of await navigator.clipboard.read()) {
      const type = item.types.find((t) => t.startsWith('image/'));
      if (type) blobs.push(await item.getType(type));
    }
    if (blobs.length) addPasted(blobs);
    else setStatus(NO_IMAGE_MSG);
  } catch (err) {
    console.warn('Không đọc được bộ nhớ tạm:', err);
    askManual();
  }
});

// ---------- Danh sách ảnh ----------
function addFiles(fileList) {
  const all = [...fileList];
  const images = all.filter((f) => f.type.startsWith('image/'));
  if (images.length < all.length) toast('Đã bỏ qua các file không phải ảnh.', { type: 'error' });
  const added = images.map((file) =>
    insertItem({ id: nextId++, name: file.name, file, url: URL.createObjectURL(file), text: '', state: 'pending' })
  );
  refresh();
  return added;
}

function insertItem(item, at = items.length) {
  item.el = renderItem(item);
  list.insertBefore(item.el, list.children[at] || null);
  items.splice(at, 0, item);
  if (item.text) fitTextarea(item.el.querySelector('textarea'));
  return item;
}

function iconBtn(act, name, label) {
  return `<button class="icon-btn sm" type="button" data-act="${act}" aria-label="${label}" title="${label}">${icon(name)}</button>`;
}

function renderItem(item) {
  const el = document.createElement('article');
  el.className = 'item' + (item.url ? '' : ' no-image');
  el.dataset.id = item.id;
  el.innerHTML = `
    <button class="thumb" type="button" data-act="view" aria-label="Xem ảnh lớn">
      <img alt="" />
      <span class="thumb-ph">${icon('image')}<small>Ảnh không được lưu trong lịch sử</small></span>
      <span class="thumb-zoom" aria-hidden="true">${icon('expand')}</span>
      <span class="scanline" aria-hidden="true"></span>
    </button>
    <div class="item-body">
      <div class="item-head">
        <span class="grip" title="Kéo để đổi thứ tự" aria-hidden="true">${icon('grip')}</span>
        <span class="item-no"></span>
        <span class="name"></span>
        <span class="badge"></span>
        <div class="item-actions">
          ${iconBtn('up', 'up', 'Đưa lên trước')}
          ${iconBtn('down', 'down', 'Đưa xuống sau')}
          ${iconBtn('rotate', 'rotate', 'Xoay 90° rồi đọc lại')}
          ${iconBtn('reocr', 'refresh', 'Đọc lại ảnh này')}
          ${iconBtn('copy', 'copy', 'Sao chép chữ')}
          ${iconBtn('remove', 'trash', 'Xoá ảnh')}
        </div>
      </div>
      <textarea spellcheck="false" aria-label="Chữ trích xuất từ ảnh" placeholder="Chữ trích xuất từ ảnh sẽ hiện ở đây. Bạn có thể sửa trước khi tải file."></textarea>
      <div class="item-foot"><span class="words"></span><span class="err"></span></div>
    </div>`;
  if (item.url) el.querySelector('img').src = item.url;
  el.querySelector('.name').textContent = item.name;
  el.querySelector('.name').title = item.name;
  const ta = el.querySelector('textarea');
  ta.value = item.text;
  ta.addEventListener('input', () => {
    item.text = ta.value;
    updateWords(item);
    fitTextarea(ta);
    schedulePreview();
  });
  updateItem(item, el);
  return el;
}

// Ô chữ tự giãn theo nội dung (tối đa ~18 dòng, dài hơn thì cuộn)
function fitTextarea(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight + 2, 460) + 'px';
}

function updateWords(item, el = item.el) {
  const n = item.text.trim() ? item.text.trim().split(/\s+/).length : 0;
  el.querySelector('.words').textContent = n ? `${n} từ` : '';
}

function updateItem(item, el = item.el) {
  el.dataset.state = item.state;
  const badge = el.querySelector('.badge');
  badge.className = 'badge ' + item.state;
  badge.textContent = STATE_LABEL[item.state];
  el.querySelector('.err').textContent = item.state === 'error' ? item.error || 'Không đọc được ảnh này' : '';
  const noFile = !item.file;
  el.querySelector('[data-act="rotate"]').disabled = noFile || busy;
  el.querySelector('[data-act="reocr"]').disabled = noFile || busy;
  el.querySelector('[data-act="remove"]').disabled = busy;
  el.querySelector('.thumb').disabled = !item.url;
  el.querySelector('textarea').readOnly = item.state === 'working';
  updateWords(item, el);
}

// Số thứ tự hiển thị và nút lên/xuống theo vị trí hiện tại
function renumber() {
  items.forEach((item, i) => {
    item.el.querySelector('.item-no').textContent = String(i + 1).padStart(2, '0');
    item.el.querySelector('[data-act="up"]').disabled = i === 0;
    item.el.querySelector('[data-act="down"]').disabled = i === items.length - 1;
  });
}

list.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn || btn.disabled) return;
  const item = byId(btn.closest('.item').dataset.id);
  if (!item) return;
  const act = btn.dataset.act;
  if (act === 'view') openViewer(item);
  else if (act === 'up') moveItem(item, -1);
  else if (act === 'down') moveItem(item, 1);
  else if (act === 'rotate') rotateItem(item);
  else if (act === 'reocr') {
    item.state = 'pending';
    runOcr([item]);
  } else if (act === 'copy') copyText(item.text, 'Đã sao chép chữ của ảnh');
  else if (act === 'remove') removeItem(item);
});

function moveItem(item, delta) {
  const i = items.indexOf(item);
  const j = i + delta;
  if (j < 0 || j >= items.length) return;
  items.splice(i, 1);
  items.splice(j, 0, item);
  list.insertBefore(item.el, delta < 0 ? items[j + 1].el : items[j - 1].el.nextSibling);
  item.el.querySelector(`[data-act="${delta < 0 ? 'up' : 'down'}"]`).focus();
  refresh();
  saveSoon();
}

// Kéo tay nắm ⋮⋮ để đổi thứ tự (nút lên/xuống dùng được bằng bàn phím và trên điện thoại)
let dragEl = null;
list.addEventListener('pointerdown', (e) => {
  const grip = e.target.closest('.grip');
  if (grip && !busy) grip.closest('.item').draggable = true;
});
document.addEventListener('pointerup', () => {
  if (!dragEl) list.querySelectorAll('.item[draggable="true"]').forEach((el) => (el.draggable = false));
});
list.addEventListener('dragstart', (e) => {
  const el = e.target.closest('.item');
  if (!el || !el.draggable) return;
  dragEl = el;
  el.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', el.dataset.id);
});
list.addEventListener('dragover', (e) => {
  if (!dragEl) return;
  e.preventDefault();
  const over = e.target.closest('.item');
  if (!over || over === dragEl) return;
  const r = over.getBoundingClientRect();
  list.insertBefore(dragEl, e.clientY > r.top + r.height / 2 ? over.nextSibling : over);
});
list.addEventListener('drop', (e) => {
  if (dragEl) e.preventDefault();
});
list.addEventListener('dragend', () => {
  if (!dragEl) return;
  dragEl.classList.remove('dragging');
  dragEl.draggable = false;
  dragEl = null;
  const before = items.map((i) => i.id).join();
  items = [...list.children].map((el) => byId(el.dataset.id));
  if (items.map((i) => i.id).join() !== before) {
    refresh();
    saveSoon();
  }
});

// Xoay ảnh 90° theo chiều kim đồng hồ (ảnh chụp bị nghiêng/ngang) rồi đọc lại
async function rotateFile(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const canvas = document.createElement('canvas');
  canvas.width = bmp.height;
  canvas.height = bmp.width;
  const ctx = canvas.getContext('2d');
  ctx.translate(canvas.width, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const type = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.95));
  return new File([blob], file.name, { type });
}

async function rotateItem(item) {
  if (busy || !item.file) return;
  try {
    const file = await rotateFile(item.file);
    URL.revokeObjectURL(item.url);
    item.file = file;
    item.url = URL.createObjectURL(file);
    item.el.querySelector('img').src = item.url;
    if (item.pasted) renderPasteInfo();
    item.state = 'pending';
    runOcr([item]);
  } catch (err) {
    toast('Không xoay được ảnh: ' + err.message, { type: 'error' });
  }
}

function removeItem(item) {
  if (busy) return;
  const at = items.indexOf(item);
  item.el.remove();
  items.splice(at, 1);
  refresh();
  renderPasteInfo();
  saveSoon();
  toast(`Đã xoá ${item.name}`, {
    action: {
      label: 'Hoàn tác',
      fn: () => {
        items.splice(Math.min(at, items.length), 0, item);
        list.insertBefore(item.el, list.children[at] || null);
        refresh();
        renderPasteInfo();
        saveSoon();
      },
    },
    onClose: (undone) => {
      if (!undone && item.url) URL.revokeObjectURL(item.url);
    },
  });
}

function clearItems() {
  items.forEach((i) => i.url && URL.revokeObjectURL(i.url));
  items = [];
  list.innerHTML = '';
  sessionId = null;
  setStatus('');
  refresh();
  renderPasteInfo();
}

clearBtn.addEventListener('click', async () => {
  if (busy) return;
  const ok = await confirmBox({
    title: `Xoá tất cả ${items.length} ảnh?`,
    message: 'Danh sách ảnh và chữ đã trích xuất sẽ bị xoá khỏi trang. Phần chữ đã đọc vẫn còn trong Lịch sử làm việc.',
    ok: 'Xoá tất cả',
    danger: true,
  });
  if (ok) clearItems();
});

// ---------- Trạng thái chung của trang ----------
function refresh() {
  renderPreview();
  updateUi();
}

function updateUi() {
  const pending = items.filter((i) => i.file && (i.state === 'pending' || i.state === 'error')).length;
  const hasDone = items.some((i) => i.state === 'done');
  ocrBtn.disabled = busy || !pending;
  $('ocrBtnText').textContent = busy ? 'Đang trích xuất…' : pending > 1 ? `Trích xuất ${pending} ảnh` : 'Trích xuất chữ';
  const canExport = !busy && hasDone && lastText !== '';
  [exportBtn, copyBtn, txtBtn, mixBtn].forEach((b) => (b.disabled = !canExport));
  clearBtn.disabled = busy || items.length === 0;
  findBtn.disabled = busy || !items.some((i) => i.text);
  $('dockOcr').disabled = ocrBtn.disabled;
  $('dockExport').disabled = exportBtn.disabled;
  $('dock').hidden = items.length === 0;

  $('countChip').textContent = items.length;
  $('emptyList').hidden = items.length > 0;
  $('capture').classList.toggle('compact', items.length > 0);
  items.forEach((i) => updateItem(i));
  renumber();

  // Bước hiện tại: 1 chưa có ảnh, 2 đã có ảnh, 3 đã có chữ để xuất
  const step = items.length === 0 ? 1 : hasDone ? 3 : 2;
  document.querySelectorAll('.steps li').forEach((li) => {
    const n = Number(li.dataset.step);
    li.classList.toggle('done', n < step);
    li.classList.toggle('current', n === step);
    if (n === step) li.setAttribute('aria-current', 'step');
    else li.removeAttribute('aria-current');
  });
}

// ---------- Đánh số & lọc câu hỏi trùng ----------
function sourceItems() {
  return items
    .map((it, i) => ({ name: it.name, index: i + 1, text: it.text, state: it.state }))
    .filter((it) => it.state === 'done');
}

function computeResult() {
  return Questions.processItems(sourceItems(), {
    number: optNumber.checked,
    format: optFormat.value,
    dedupe: optDedupe.checked,
    threshold: Number(optThreshold.value) / 100,
  });
}

// Nội dung file: chỉ các câu hỏi, nối liền nhau, mỗi câu cách nhau 1 dòng trống
function finalText(result) {
  const parts = result.questions || result.blocks.map((b) => b.text);
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .join('\n\n');
}

let previewTimer = null;
function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    refresh();
    saveSoon();
  }, 250);
}

function renderPreview() {
  optFormat.disabled = !optNumber.checked;
  optThreshold.disabled = !optDedupe.checked;
  $('thresholdVal').textContent = optThreshold.value + '%';

  const done = items.filter((i) => i.state === 'done').length;
  const result = computeResult();
  lastText = done ? finalText(result) : '';

  $('kpiImages').textContent = done;
  $('kpiQuestions').textContent = done && result.total !== null ? result.total : '–';
  $('kpiDups').textContent = done && optDedupe.checked ? result.removed.length : '–';
  $('dupCount').textContent = result.removed.length;

  // Câu bị loại vì trùng
  const dupList = $('dupList');
  dupList.innerHTML = '';
  if (!result.removed.length) {
    dupList.innerHTML = `<li class="dups-empty">${optDedupe.checked ? 'Không có câu nào bị loại vì trùng.' : 'Đang tắt chức năng lọc câu trùng.'}</li>`;
  }
  result.removed.forEach((r) => {
    const li = document.createElement('li');
    const head = document.createElement('div');
    head.className = 'dup-head';
    head.innerHTML = `<span class="dup-score"></span><span class="dup-meta"></span>`;
    head.querySelector('.dup-score').textContent = `${Math.round(r.score * 100)}%`;
    head.querySelector('.dup-meta').textContent = `Ảnh ${r.index} · trùng với câu ${r.duplicateOf}`;
    const body = document.createElement('pre');
    body.textContent = r.text;
    li.append(head, body);
    dupList.appendChild(li);
  });

  // Xem trước giống file Word: phông, cỡ chữ, tiêu đề, số câu in đậm
  const paper = $('preview');
  paper.style.fontFamily = `'${docFont.value}', serif`;
  paper.style.fontSize = `${Number(docSize.value) + 2}px`;
  paper.innerHTML = '';
  if (!lastText) {
    paper.classList.add('is-empty');
    paper.innerHTML = `<div class="paper-empty">${icon('file-text')}<p>Nội dung file Word sẽ hiện ở đây sau khi trích xuất chữ.</p></div>`;
    return;
  }
  paper.classList.remove('is-empty');
  const frag = document.createDocumentFragment();
  const title = docTitle.value.trim();
  if (title) {
    const h = document.createElement('div');
    h.className = 'paper-title';
    h.textContent = title;
    frag.appendChild(h);
  }
  lastText.split('\n').forEach((line) => {
    const p = document.createElement('div');
    p.className = 'paper-line';
    const m = optNumber.checked && NUM_RE.exec(line);
    if (m) {
      const b = document.createElement('b');
      b.textContent = m[1];
      p.append(b, m[2]);
    } else p.textContent = line || ' ';
    frag.appendChild(p);
  });
  paper.appendChild(frag);
}

[optNumber, optFormat, optDedupe, optThreshold].forEach((el) =>
  el.addEventListener('input', () => {
    refresh();
    saveSoon();
  })
);
[docTitle, docFont, docSize].forEach((el) => el.addEventListener('input', renderPreview));

// Thẻ "Xem trước" / "Câu trùng" (dùng được phím ← →)
const tabs = [$('tabPreview'), $('tabDups')];
function selectTab(tab) {
  tabs.forEach((t) => {
    const on = t === tab;
    t.setAttribute('aria-selected', on);
    t.tabIndex = on ? 0 : -1;
    $(t.getAttribute('aria-controls')).hidden = !on;
  });
}
tabs.forEach((t, i) => {
  t.addEventListener('click', () => selectTab(t));
  t.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    selectTab(next);
    next.focus();
  });
});

// ---------- OCR: nhận dạng lần lượt từng ảnh ngay trên trình duyệt ----------
const BASE_TITLE = document.title;

function setRun(done, total, started, name) {
  const pct = Math.round((done / total) * 100);
  const bar = $('progress');
  bar.firstElementChild.style.width = pct + '%';
  bar.setAttribute('aria-valuenow', pct);
  $('runLabel').textContent = done < total ? `Đang đọc ảnh ${done + 1}/${total} · ${name}` : `Đã đọc xong ${total} ảnh`;
  let eta = '';
  if (done > 0 && done < total) {
    const secs = Math.round(((performance.now() - started) / done) * (total - done) / 1000);
    eta = secs >= 60 ? `còn khoảng ${Math.round(secs / 60)} phút` : `còn khoảng ${Math.max(1, secs)} giây`;
  }
  $('runEta').textContent = eta;
  document.title = done < total ? `(${done}/${total}) Đang đọc… – Đức Thắng` : BASE_TITLE;
}

async function runOcr(queue) {
  queue = queue.filter((i) => i.file);
  if (busy || !queue.length) return;
  busy = true;
  updateUi();
  const run = $('run');
  run.hidden = false;
  run.classList.remove('finished');
  const started = performance.now();

  let done = 0;
  for (const item of queue) {
    setRun(done, queue.length, started, item.name);
    OCR.setProgressListener((msg) => setStatus(msg));
    item.state = 'working';
    updateItem(item);
    setStatus('');
    try {
      const text = await OCR.recognize(item.file);
      item.text = text;
      item.el.querySelector('textarea').value = text;
      fitTextarea(item.el.querySelector('textarea'));
      item.state = 'done';
    } catch (err) {
      console.error(err);
      item.state = 'error';
      item.error = 'Không đọc được ảnh này' + (err && err.message ? ` (${err.message})` : '');
    }
    updateItem(item);
    done++;
    renderPreview(); // kết quả hiện dần theo từng ảnh
  }

  setRun(done, queue.length, started, '');
  run.classList.add('finished');
  const errors = queue.filter((i) => i.state === 'error').length;
  if (errors) {
    setStatus(`Có ${errors} ảnh bị lỗi. Bấm "Trích xuất chữ" để thử lại các ảnh lỗi.`);
    toast(`Hoàn tất, ${errors} ảnh bị lỗi`, { type: 'error' });
  } else {
    setStatus(`Đã trích xuất xong ${queue.length} ảnh. Kiểm tra lại nội dung rồi tải file.`);
    toast(`Đã đọc xong ${queue.length} ảnh`);
  }
  busy = false;
  refresh();
  saveNow();
  setTimeout(() => {
    if (!busy) run.hidden = true;
  }, 2500);
}

ocrBtn.addEventListener('click', () => runOcr(items.filter((i) => i.state === 'pending' || i.state === 'error')));
$('dockOcr').addEventListener('click', () => ocrBtn.click());

// ---------- Xuất file (tạo ngay trên trình duyệt) ----------
function docStyle() {
  return { font: docFont.value, size: Number(docSize.value) };
}

function textRun(t, { font, size }, bold = false, extra = 0) {
  return new docx.TextRun({ text: t, bold, font, size: (size + extra) * 2 });
}

// Mỗi dòng một đoạn văn; số câu ở đầu dòng in đậm
function paragraphsOf(text, style, boldNumbers) {
  const { Paragraph } = docx;
  // Các câu hỏi viết liền nhau, mỗi câu cách nhau đúng 1 dòng trống
  const clean = text.replace(/\r\n?/g, '\n').replace(/\n(?:[ \t]*\n)+/g, '\n\n').trim();
  return clean.split('\n').map((line) => {
    const m = boldNumbers && NUM_RE.exec(line);
    return new Paragraph({ children: m ? [textRun(m[1], style, true), textRun(m[2], style)] : [textRun(line, style)] });
  });
}

function headingParagraphs(lines, style) {
  const { Paragraph, AlignmentType } = docx;
  return lines
    .filter(Boolean)
    .map((t, i) => new Paragraph({ alignment: AlignmentType.CENTER, children: [textRun(t, style, true, i === 0 ? 2 : 0)] }))
    .concat(lines.some(Boolean) ? [new Paragraph({ children: [] })] : []);
}

function makeDoc(sections) {
  return docx.Packer.toBlob(
    new docx.Document({
      creator: username || 'Đức Thắng',
      title: docTitle.value.trim() || 'Đức Thắng – Văn bản trích xuất từ ảnh',
      sections,
    })
  );
}

function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

async function withBusy(label, fn) {
  busy = true;
  updateUi();
  setStatus(label);
  try {
    await fn();
  } catch (err) {
    console.error(err);
    toast('Lỗi khi tạo file: ' + err.message, { type: 'error' });
  } finally {
    busy = false;
    setStatus('');
    updateUi();
  }
}

exportBtn.addEventListener('click', () => {
  const result = computeResult();
  const text = finalText(result);
  if (!text) return toast('Không có nội dung để xuất.', { type: 'error' });
  withBusy('Đang tạo file Word…', async () => {
    const style = docStyle();
    const children = headingParagraphs([docTitle.value.trim()], style).concat(paragraphsOf(text, style, optNumber.checked));
    download(await makeDoc([{ children }]), `van-ban-tu-anh-${stamp()}.docx`);
    toast(result.total !== null ? `Đã tải file Word gồm ${result.total} câu hỏi` : 'Đã tải file Word');
    saveNow();
  });
});
$('dockExport').addEventListener('click', () => exportBtn.click());

function plainText() {
  const title = docTitle.value.trim();
  return (title ? title + '\n\n' : '') + lastText;
}

txtBtn.addEventListener('click', () => {
  download(new Blob([plainText() + '\n'], { type: 'text/plain;charset=utf-8' }), `van-ban-tu-anh-${stamp()}.txt`);
  toast('Đã tải file .txt');
});

async function copyText(text, okMsg) {
  if (!text) return toast('Chưa có chữ để sao chép.', { type: 'error' });
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Trình duyệt cũ / không cho quyền: chép qua ô chữ ẩn
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast(okMsg);
}
copyBtn.addEventListener('click', () => copyText(plainText(), 'Đã sao chép toàn bộ câu hỏi'));

// ---------- Trộn đề ----------
mixBtn.addEventListener('click', () => {
  const format = optNumber.checked ? optFormat.value : 'Câu {n}:';
  const result = Questions.processItems(sourceItems(), {
    number: true,
    format,
    dedupe: optDedupe.checked,
    threshold: Number(optThreshold.value) / 100,
  });
  if (!result.questions.length) return toast('Chưa nhận ra câu hỏi nào để trộn.', { type: 'error' });
  const clamp = (v, lo, hi, d) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d);
  const count = clamp(Number($('mixCount').value), 1, 12, 4);
  const start = clamp(Number($('mixStart').value), 1, 9999, 101);
  $('mixCount').value = count;
  $('mixStart').value = start;
  const shuffleOptions = $('mixOptions').checked;

  withBusy('Đang tạo đề trộn…', async () => {
    const { Paragraph, Table, TableRow, TableCell, WidthType } = docx;
    const style = docStyle();
    const title = docTitle.value.trim();
    const versions = Shuffle.makeVersions(result.questions, { versions: count, startCode: start, shuffleOptions, format });
    const sections = versions.map((v) => ({
      children: headingParagraphs([title, `Mã đề ${v.code}`], style).concat(paragraphsOf(v.questions.join('\n\n'), style, true)),
    }));

    if ($('mixKey').checked) {
      const cell = (t, bold = false) => new TableCell({ children: [new Paragraph({ children: [textRun(t, style, bold)] })] });
      const children = headingParagraphs(['Bảng đối chiếu với đề gốc'], style);
      versions.forEach((v) => {
        children.push(new Paragraph({ children: [textRun(`Mã đề ${v.code}`, style, true)] }));
        const rows = [new TableRow({ tableHeader: true, children: ['Câu', 'Câu gốc', 'Đáp án gốc → vị trí mới'].map((h) => cell(h, true)) })];
        v.map.forEach((m) => rows.push(new TableRow({ children: [cell(String(m.no)), cell(String(m.orig)), cell(m.options || '—')] })));
        children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }));
        children.push(new Paragraph({ children: [] }));
      });
      sections.push({ children });
    }

    download(await makeDoc(sections), `de-tron-${count}-ma-${stamp()}.docx`);
    toast(`Đã tạo ${count} mã đề, mỗi đề ${result.questions.length} câu`);
  });
});

// ---------- Tìm & thay trong tất cả ảnh ----------
const findDialog = $('findDialog');
const findText = $('findText');
const replaceText = $('replaceText');

function findRegex() {
  const q = findText.value;
  if (!q) return null;
  let src = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if ($('findWord').checked) src = `(?<![\\p{L}\\p{M}\\p{N}])${src}(?![\\p{L}\\p{M}\\p{N}])`;
  return new RegExp(src, 'gu' + ($('findCase').checked ? '' : 'i'));
}

function updateFindCount() {
  const re = findRegex();
  let total = 0;
  let inItems = 0;
  if (re) {
    items.forEach((it) => {
      const n = (it.text.match(re) || []).length;
      total += n;
      if (n) inItems++;
    });
  }
  $('findCount').textContent = !re ? '' : total ? `Tìm thấy ${total} chỗ trong ${inItems} ảnh` : 'Không tìm thấy';
  $('replaceAllBtn').disabled = !total;
}
[findText, $('findCase'), $('findWord')].forEach((el) => el.addEventListener('input', updateFindCount));

function openFind() {
  if (findBtn.disabled) return;
  // Lấy sẵn đoạn chữ đang bôi đen làm từ cần tìm
  const sel = document.activeElement && document.activeElement.tagName === 'TEXTAREA'
    ? document.activeElement.value.slice(document.activeElement.selectionStart, document.activeElement.selectionEnd)
    : '';
  if (sel && !sel.includes('\n')) findText.value = sel;
  updateFindCount();
  findDialog.showModal();
  findText.select();
}
findBtn.addEventListener('click', openFind);

$('findForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const re = findRegex();
  if (!re || busy) return;
  const rep = replaceText.value;
  const before = new Map(items.map((it) => [it, it.text]));
  let total = 0;
  items.forEach((it) => {
    const next = it.text.replace(re, () => {
      total++;
      return rep;
    });
    if (next !== it.text) setItemText(it, next);
  });
  findDialog.close();
  refresh();
  saveSoon();
  toast(`Đã thay ${total} chỗ`, {
    action: {
      label: 'Hoàn tác',
      fn: () => {
        before.forEach((text, it) => setItemText(it, text));
        refresh();
        saveSoon();
      },
    },
    timeout: 8000,
  });
});

function setItemText(item, text) {
  item.text = text;
  item.el.querySelector('textarea').value = text;
  fitTextarea(item.el.querySelector('textarea'));
  updateWords(item);
  if (viewing === item) $('vText').value = text;
}

// ---------- Xem ảnh lớn cạnh chữ ----------
const viewer = $('viewer');
const vImg = $('vImg');
const vText = $('vText');
const ZOOMS = [0, 1, 1.5, 2, 3]; // 0 = vừa khung
let viewing = null;
let zoomIdx = 0;

const viewable = () => items.filter((i) => i.url);

function openViewer(item) {
  viewing = item;
  zoomIdx = 0;
  const all = viewable();
  const k = all.indexOf(item);
  $('viewerTitle').textContent = `Ảnh ${items.indexOf(item) + 1}/${items.length} · ${item.name}`;
  vImg.src = item.url;
  vImg.alt = item.name;
  vText.value = item.text;
  vText.readOnly = item.state === 'working';
  $('vPrev').disabled = k <= 0;
  $('vNext').disabled = k >= all.length - 1;
  applyZoom();
  if (!viewer.open) viewer.showModal();
}

function applyZoom() {
  const z = ZOOMS[zoomIdx];
  $('vImgWrap').classList.toggle('zoomed', z > 0);
  vImg.style.width = z ? `${vImg.naturalWidth * z}px` : '';
  $('vZoomVal').textContent = z ? `${Math.round(z * 100)}%` : 'Vừa khung';
  $('vZoomOut').disabled = zoomIdx === 0;
  $('vZoomIn').disabled = zoomIdx === ZOOMS.length - 1;
}
vImg.addEventListener('load', applyZoom);
$('vZoomIn').addEventListener('click', () => {
  zoomIdx = Math.min(ZOOMS.length - 1, zoomIdx + 1);
  applyZoom();
});
$('vZoomOut').addEventListener('click', () => {
  zoomIdx = Math.max(0, zoomIdx - 1);
  applyZoom();
});
vImg.addEventListener('click', () => {
  zoomIdx = zoomIdx ? 0 : 2;
  applyZoom();
});

function stepViewer(delta) {
  const all = viewable();
  const next = all[all.indexOf(viewing) + delta];
  if (next) openViewer(next);
}
$('vPrev').addEventListener('click', () => stepViewer(-1));
$('vNext').addEventListener('click', () => stepViewer(1));
viewer.addEventListener('keydown', (e) => {
  if (e.target === vText) return;
  if (e.key === 'ArrowLeft') stepViewer(-1);
  else if (e.key === 'ArrowRight') stepViewer(1);
});
viewer.addEventListener('close', () => (viewing = null));
vText.addEventListener('input', () => {
  if (!viewing) return;
  viewing.text = vText.value;
  viewing.el.querySelector('textarea').value = vText.value;
  fitTextarea(viewing.el.querySelector('textarea'));
  updateWords(viewing);
  schedulePreview();
});

// ---------- Lịch sử làm việc (chỉ lưu chữ, trên trình duyệt này) ----------
let sessionId = null;
let saveTimer = null;

function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 800);
}

function saveNow() {
  clearTimeout(saveTimer);
  const done = items.filter((i) => i.state === 'done');
  if (!username || !done.length) return;
  if (!sessionId) sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const result = computeResult();
  const first = (result.questions || []).find(Boolean) || done[0].text;
  Sessions.save({
    id: sessionId,
    updatedAt: Date.now(),
    items: done.map((i) => ({ name: i.name, text: i.text })),
    opts: { number: optNumber.checked, format: optFormat.value, dedupe: optDedupe.checked, threshold: optThreshold.value, title: docTitle.value },
    total: result.total,
    snippet: first.replace(/\s+/g, ' ').slice(0, 140),
  });
}

const fmtDate = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' });

function renderHistory() {
  const ul = $('historyList');
  const entries = Sessions.list();
  ul.innerHTML = '';
  $('historyClear').hidden = entries.length === 0;
  if (!entries.length) {
    ul.innerHTML = `<li class="history-empty">${icon('history')}<p>Chưa có phiên làm việc nào. Sau khi trích xuất chữ, kết quả sẽ tự được lưu ở đây.</p></li>`;
    return;
  }
  entries.forEach((e) => {
    const li = document.createElement('li');
    li.className = 'history-item' + (e.id === sessionId ? ' current' : '');
    li.innerHTML = `
      <div class="h-top"><time></time><span class="h-cur">Đang mở</span></div>
      <div class="h-meta"></div>
      <p class="h-snippet"></p>
      <div class="h-actions">
        <button class="btn btn-outline btn-sm" data-h="open" type="button">Mở lại</button>
        <button class="icon-btn sm" data-h="del" type="button" aria-label="Xoá phiên này" title="Xoá phiên này">${icon('trash')}</button>
      </div>`;
    li.querySelector('time').textContent = fmtDate.format(e.updatedAt);
    li.querySelector('.h-meta').textContent = `${e.items.length} ảnh` + (e.total !== null && e.total !== undefined ? ` · ${e.total} câu hỏi` : '');
    li.querySelector('.h-snippet').textContent = e.snippet || '';
    li.querySelector('[data-h="open"]').addEventListener('click', () => restoreSession(e.id));
    li.querySelector('[data-h="del"]').addEventListener('click', () => {
      Sessions.remove(e.id);
      if (e.id === sessionId) sessionId = null;
      renderHistory();
    });
    ul.appendChild(li);
  });
}

$('historyBtn').addEventListener('click', () => {
  saveNow();
  renderHistory();
  $('historyDialog').showModal();
});

$('historyClear').addEventListener('click', async () => {
  $('historyDialog').close();
  const ok = await confirmBox({ title: 'Xoá toàn bộ lịch sử?', message: 'Tất cả các phiên đã lưu trên trình duyệt này sẽ bị xoá vĩnh viễn.', ok: 'Xoá lịch sử', danger: true });
  if (ok) {
    Sessions.clear();
    sessionId = null;
    toast('Đã xoá lịch sử');
  }
});

async function restoreSession(id) {
  const entry = Sessions.get(id);
  if (!entry || busy) return;
  $('historyDialog').close();
  if (items.length && id !== sessionId) {
    saveNow();
    const ok = await confirmBox({
      title: 'Mở lại phiên này?',
      message: 'Danh sách ảnh hiện tại sẽ được thay bằng phần chữ của phiên đã lưu (công việc hiện tại vẫn còn trong lịch sử).',
      ok: 'Mở lại',
    });
    if (!ok) return;
  }
  clearItems();
  entry.items.forEach((it) => insertItem({ id: nextId++, name: it.name, file: null, url: null, text: it.text, state: 'done' }));
  const o = entry.opts || {};
  if (o.format) optFormat.value = o.format;
  if (o.number !== undefined) optNumber.checked = o.number;
  if (o.dedupe !== undefined) optDedupe.checked = o.dedupe;
  if (o.threshold) optThreshold.value = o.threshold;
  docTitle.value = o.title || '';
  sessionId = entry.id;
  refresh();
  toast(`Đã mở lại ${entry.items.length} ảnh từ lịch sử`);
}

// ---------- Phím tắt ----------
$('shortcutBtn').addEventListener('click', () => $('shortcutDialog').showModal());

document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  const typing = e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]');
  const dialogOpen = document.querySelector('dialog[open]');
  if (mod && key === 'enter') {
    e.preventDefault();
    if (!ocrBtn.disabled) ocrBtn.click();
  } else if (mod && !e.shiftKey && key === 's') {
    e.preventDefault();
    if (!exportBtn.disabled) exportBtn.click();
  } else if (mod && e.shiftKey && key === 'f') {
    e.preventDefault();
    if (!dialogOpen) openFind();
  } else if (mod && !e.shiftKey && key === 'o') {
    e.preventDefault();
    fileInput.click();
  } else if (e.key === '?' && !typing && !dialogOpen) {
    $('shortcutDialog').showModal();
  }
});

refresh();
