const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const list = document.getElementById('list');
const ocrBtn = document.getElementById('ocrBtn');
const exportBtn = document.getElementById('exportBtn');
const clearBtn = document.getElementById('clearBtn');
const statusEl = document.getElementById('status');
const progress = document.getElementById('progress');
const progressBar = progress.firstElementChild;
const qPanel = document.getElementById('qPanel');
const optNumber = document.getElementById('optNumber');
const optFormat = document.getElementById('optFormat');
const optDedupe = document.getElementById('optDedupe');
const optThreshold = document.getElementById('optThreshold');

// Mỗi phần tử: { id, file, url, text, state: 'pending' | 'working' | 'done' | 'error', el }
let items = [];
let busy = false;
let nextId = 1;

const STATE_LABEL = { pending: 'Chờ xử lý', working: 'Đang đọc…', done: 'Hoàn tất', error: 'Lỗi' };

// ---------- Người dùng ----------
let username = '';
fetch('/api/me')
  .then((r) => (r.ok ? r.json() : Promise.reject()))
  .then((u) => {
    username = u.username;
    document.getElementById('who').textContent = 'Xin chào, ' + u.username;
  })
  .catch(() => (window.location.href = '/login'));

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login';
});

// Tải sẵn bộ nhận dạng chữ ở nền để lúc bấm "Trích xuất chữ" chạy nhanh hơn
OCR.preload().catch((err) => console.warn('Chưa tải được bộ nhận dạng chữ:', err));

// ---------- Chọn / kéo thả ảnh ----------
dropzone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  addFiles(fileInput.files);
  fileInput.value = '';
});
['dragenter', 'dragover'].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.add('drag');
  })
);
['dragleave', 'drop'].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag');
  })
);
dropzone.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));

// ---------- Dán ảnh: nút "Dán ảnh", ô dán, hoặc Ctrl+V ở bất kỳ đâu trên trang ----------
const pasteZone = document.getElementById('pasteZone');
const pasteTarget = document.getElementById('pasteTarget');
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
  const names = added.map((i) => i.file.name).join(', ');
  setStatus(`Đã dán ${names} – danh sách có ${items.length} ảnh. Copy ảnh khác rồi dán tiếp, hoặc bấm "Trích xuất chữ".`);
  // Nháy viền để thấy rõ mỗi lần dán, kể cả khi dán liên tiếp
  pasteZone.classList.remove('ok');
  void pasteZone.offsetWidth;
  pasteZone.classList.add('ok');
  clearTimeout(addPasted.timer);
  addPasted.timer = setTimeout(() => pasteZone.classList.remove('ok'), 1200);
}

// Ảnh thu nhỏ của các ảnh đã dán ngay trong ô dán, để thấy ảnh mới xuất hiện mỗi lần dán
// (danh sách ảnh đầy đủ nằm bên dưới, thường khuất khỏi màn hình)
const MAX_THUMBS = 8;
function renderPasteInfo() {
  const pasted = items.filter((i) => i.pasted);
  const info = document.getElementById('pasteInfo');
  const thumbs = document.getElementById('pasteThumbs');
  info.hidden = pasted.length === 0;
  document.getElementById('pasteCountText').textContent = `✅ Đã dán ${pasted.length} ảnh – dán tiếp được`;
  thumbs.innerHTML = '';
  pasted.slice(-MAX_THUMBS).forEach((item) => {
    const img = document.createElement('img');
    img.src = item.url;
    img.alt = item.file.name;
    img.title = `${item.file.name} – bấm để xem trong danh sách`;
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
pasteTarget.addEventListener('drop', (e) => {
  e.preventDefault();
  addFiles(e.dataTransfer.files);
});

// Nút "Dán ảnh": đọc thẳng bộ nhớ tạm (trình duyệt có thể hỏi quyền lần đầu).
// Trình duyệt không hỗ trợ hoặc bị từ chối thì chuyển sang ô dán để người dùng tự dán.
document.getElementById('pasteBtn').addEventListener('click', async () => {
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

function addFiles(fileList) {
  const images = [...fileList].filter((f) => f.type.startsWith('image/'));
  if (images.length < fileList.length) setStatus('Đã bỏ qua các file không phải ảnh.');
  const added = images.map((file) => {
    const item = { id: nextId++, file, url: URL.createObjectURL(file), text: '', state: 'pending' };
    item.el = renderItem(item);
    list.appendChild(item.el);
    items.push(item);
    return item;
  });
  updateButtons();
  return added;
}

function renderItem(item) {
  const el = document.createElement('div');
  el.className = 'item';
  el.innerHTML = `
    <img alt="" />
    <div>
      <div class="meta">
        <span class="name"></span>
        <span>
          <span class="badge"></span>
          <button class="remove" title="Xoá ảnh">✕ Xoá</button>
        </span>
      </div>
      <textarea placeholder="Chữ trích xuất từ ảnh sẽ hiện ở đây. Bạn có thể chỉnh sửa trước khi tải file."></textarea>
    </div>`;
  el.querySelector('img').src = item.url;
  el.querySelector('.name').textContent = item.file.name;
  el.querySelector('textarea').addEventListener('input', (e) => {
    item.text = e.target.value;
    schedulePreview();
  });
  el.querySelector('.remove').addEventListener('click', () => removeItem(item));
  updateBadge(item, el);
  return el;
}

function updateBadge(item, el = item.el) {
  const badge = el.querySelector('.badge');
  badge.className = 'badge ' + item.state;
  badge.textContent = STATE_LABEL[item.state];
}

function removeItem(item) {
  if (busy) return;
  URL.revokeObjectURL(item.url);
  item.el.remove();
  items = items.filter((i) => i !== item);
  updateButtons();
  renderPreview();
  renderPasteInfo();
}

clearBtn.addEventListener('click', () => {
  if (busy) return;
  items.forEach((i) => URL.revokeObjectURL(i.url));
  items = [];
  list.innerHTML = '';
  setStatus('');
  updateButtons();
  renderPreview();
  renderPasteInfo();
});

function updateButtons() {
  const hasPending = items.some((i) => i.state === 'pending' || i.state === 'error');
  const hasDone = items.some((i) => i.state === 'done');
  ocrBtn.disabled = busy || !hasPending;
  exportBtn.disabled = busy || !hasDone;
  clearBtn.disabled = busy || items.length === 0;
}

function setStatus(text) {
  statusEl.textContent = text;
}

// ---------- Đánh số & lọc câu hỏi trùng ----------
function computeResult() {
  const source = items
    .map((it, i) => ({ name: it.file.name, index: i + 1, text: it.text, state: it.state }))
    .filter((it) => it.state === 'done');
  return Questions.processItems(source, {
    number: optNumber.checked,
    format: optFormat.value,
    dedupe: optDedupe.checked,
    threshold: Number(optThreshold.value) / 100,
  });
}

let previewTimer = null;
function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderPreview, 250);
}

function renderPreview() {
  const hasDone = items.some((i) => i.state === 'done');
  qPanel.hidden = !hasDone;
  if (!hasDone) return;

  optFormat.disabled = !optNumber.checked;
  optThreshold.disabled = !optDedupe.checked;
  document.getElementById('thresholdVal').textContent = optThreshold.value + '%';

  const result = computeResult();

  const stats = [];
  if (result.total !== null) stats.push(`<b>${result.total}</b> câu hỏi`);
  if (optDedupe.checked) stats.push(`đã loại <b>${result.removed.length}</b> câu trùng`);
  document.getElementById('qStats').innerHTML = stats.join(' · ');

  const dupBox = document.getElementById('dupBox');
  const dupList = document.getElementById('dupList');
  dupBox.hidden = result.removed.length === 0;
  dupList.innerHTML = '';
  document.getElementById('dupSummary').textContent = `Xem ${result.removed.length} câu bị loại vì trùng`;
  result.removed.forEach((r) => {
    const li = document.createElement('li');
    const head = document.createElement('div');
    head.className = 'dup-head';
    head.textContent = `Ảnh ${r.index} (${r.name}) – trùng với câu ${r.duplicateOf}, giống ${Math.round(r.score * 100)}%`;
    const body = document.createElement('pre');
    body.textContent = r.text;
    li.append(head, body);
    dupList.appendChild(li);
  });

  const preview = document.getElementById('preview');
  preview.innerHTML = '';
  const text = finalText(result);
  if (text) {
    const pre = document.createElement('pre');
    pre.textContent = text;
    preview.appendChild(pre);
  } else {
    preview.textContent = 'Chưa có nội dung.';
  }
}

// Nội dung file Word: chỉ các câu hỏi, nối liền nhau, mỗi câu cách nhau 1 dòng trống
function finalText(result) {
  const parts = result.questions || result.blocks.map((b) => b.text);
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .join('\n\n');
}

[optNumber, optFormat, optDedupe, optThreshold].forEach((el) =>
  el.addEventListener('input', renderPreview)
);

// ---------- OCR: nhận dạng lần lượt từng ảnh ngay trên trình duyệt ----------
ocrBtn.addEventListener('click', async () => {
  const queue = items.filter((i) => i.state === 'pending' || i.state === 'error');
  if (!queue.length) return;
  busy = true;
  updateButtons();
  progress.classList.add('show');

  let done = 0;
  for (const item of queue) {
    const label = `Đang trích xuất ảnh ${done + 1}/${queue.length}: ${item.file.name}`;
    setStatus(label);
    OCR.setProgressListener((msg) => setStatus(`${label} – ${msg}`));
    item.state = 'working';
    updateBadge(item);
    try {
      const text = await OCR.recognize(item.file);
      item.text = text;
      item.el.querySelector('textarea').value = text;
      item.state = 'done';
    } catch (err) {
      console.error(err);
      item.state = 'error';
      item.el.querySelector('textarea').placeholder =
        'Lỗi: không đọc được ảnh này' + (err && err.message ? ` (${err.message})` : '');
    }
    updateBadge(item);
    done++;
    progressBar.style.width = `${(done / queue.length) * 100}%`;
  }

  const errors = queue.filter((i) => i.state === 'error').length;
  setStatus(
    errors
      ? `Hoàn tất với ${errors} ảnh bị lỗi. Bấm "Trích xuất chữ" để thử lại các ảnh lỗi.`
      : `Đã trích xuất xong ${queue.length} ảnh. Kiểm tra lại nội dung rồi bấm "Tải file Word".`
  );
  busy = false;
  renderPreview();
  setTimeout(() => {
    progress.classList.remove('show');
    progressBar.style.width = '0';
  }, 800);
  updateButtons();
});

// ---------- Xuất file Word (tạo ngay trên trình duyệt) ----------
function buildDocx(text, boldNumbers) {
  const { Document, Packer, Paragraph, TextRun } = docx;
  const run = (t, bold = false) => new TextRun({ text: t, bold, font: 'Times New Roman', size: 26 });
  // Các câu hỏi viết liền nhau, mỗi câu cách nhau đúng 1 dòng trống
  const clean = text.replace(/\r\n?/g, '\n').replace(/\n(?:[ \t]*\n)+/g, '\n\n').trim();
  const children = clean.split('\n').map((line) => {
    // In đậm phần số câu ("Câu 1:", "Question 2:", "3.") khi bật đánh số tự động
    const m = boldNumbers && /^((?:Câu|Question)\s+\d+[:.]|\d+\.)(\s.*|)$/.exec(line);
    return new Paragraph({ children: m ? [run(m[1], true), run(m[2])] : [run(line)] });
  });
  const doc = new Document({
    creator: username || 'Đức Thắng',
    title: 'Đức Thắng – Văn bản trích xuất từ ảnh',
    sections: [{ children }],
  });
  return Packer.toBlob(doc);
}

exportBtn.addEventListener('click', async () => {
  const result = computeResult();
  const text = finalText(result);
  if (!text) return setStatus('Không có nội dung để xuất.');
  busy = true;
  updateButtons();
  setStatus('Đang tạo file Word…');
  try {
    const blob = await buildDocx(text, optNumber.checked);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `van-ban-tu-anh-${stamp}.docx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    setStatus(result.total !== null ? `Đã tải file Word gồm ${result.total} câu hỏi.` : 'Đã tải file Word.');
  } catch (err) {
    setStatus('Lỗi khi tạo file: ' + err.message);
  } finally {
    busy = false;
    updateButtons();
  }
});
