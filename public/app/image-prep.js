// Tiền xử lý ảnh trước khi OCR: chuyển xám, làm phẳng nền, phóng to bằng Lanczos3, tăng tương phản.
// Tự tính toán thay vì để trình duyệt phóng to, vì mỗi trình duyệt phóng to một kiểu và kết quả
// OCR kém đi rõ rệt. Dùng được cả trên trình duyệt (window.ImagePrep) lẫn Node (require).
(function (root) {
  const LOBES = 3;
  // Bán kính (điểm ảnh) để ước lượng màu nền: lớn hơn nét chữ, nhỏ hơn vùng nền
  const BG_RADIUS = 15;
  // Chiều cao dòng chữ (điểm ảnh) mà Tesseract đọc tốt nhất, đo trên ảnh đề trắc nghiệm
  const TARGET_LINE_HEIGHT = 48;
  const MAX_SCALE = 3;

  // ---------- Chuyển xám + làm phẳng nền ----------
  // Ảnh chụp màn hình bằng điện thoại có sọc vân (moiré), nền loang màu, bóng đổ...
  // Ước lượng nền bằng giá trị sáng nhất quanh mỗi điểm (chữ tối sẽ bị "xoá"), làm mượt,
  // rồi chia ảnh cho nền: nền thành trắng đều, chữ vẫn tối.

  // Lọc lấy giá trị lớn nhất trong cửa sổ trượt 2r+1 theo một chiều (hàng đợi đơn điệu, O(n))
  function slidingMax(src, w, h, r, horizontal) {
    const out = new Float32Array(src.length);
    const n = horizontal ? w : h;
    const lines = horizontal ? h : w;
    const dq = new Int32Array(n);
    for (let L = 0; L < lines; L++) {
      const base = horizontal ? L * w : L;
      const step = horizontal ? 1 : w;
      let head = 0;
      let tail = 0;
      for (let j = 0; j < n + r; j++) {
        if (j < n) {
          const v = src[base + j * step];
          while (tail > head && src[base + dq[tail - 1] * step] <= v) tail--;
          dq[tail++] = j;
        }
        const x = j - r;
        if (x >= 0) {
          while (dq[head] < x - r) head++;
          out[base + x * step] = src[base + dq[head] * step];
        }
      }
    }
    return out;
  }

  // Làm mượt trung bình trong cửa sổ 2r+1 theo một chiều (tổng trượt, O(n))
  function boxBlur(src, w, h, r, horizontal) {
    const out = new Float32Array(src.length);
    const n = horizontal ? w : h;
    const lines = horizontal ? h : w;
    for (let L = 0; L < lines; L++) {
      const base = horizontal ? L * w : L;
      const step = horizontal ? 1 : w;
      let sum = 0;
      let count = 0;
      let lo = 0;
      let hi = -1;
      for (let x = 0; x < n; x++) {
        while (hi < Math.min(n - 1, x + r)) {
          sum += src[base + ++hi * step];
          count++;
        }
        while (lo < x - r) {
          sum -= src[base + lo++ * step];
          count--;
        }
        out[base + x * step] = sum / count;
      }
    }
    return out;
  }

  // rgba (w*h*4) -> ảnh xám đã làm phẳng nền, Float32 0..255
  function grayFlat(rgba, w, h) {
    const gray = new Float32Array(w * h);
    for (let i = 0, p = 0; p < gray.length; i += 4, p++) {
      const a = rgba[i + 3] / 255; // nền trong suốt coi như trắng
      const y = 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
      gray[p] = y * a + 255 * (1 - a);
    }
    const r = BG_RADIUS;
    let bg = slidingMax(slidingMax(gray, w, h, r, true), w, h, r, false);
    bg = boxBlur(boxBlur(bg, w, h, r, true), w, h, r, false);
    for (let i = 0; i < gray.length; i++) gray[i] = Math.min(255, (gray[i] / Math.max(1, bg[i])) * 255);
    return gray;
  }

  // ---------- Xoá nút chọn đáp án (vòng tròn / ô vuông rỗng) ----------
  // Nút tròn "○" trước "A." to hơn chữ và làm Tesseract đọc hỏng cả dòng khi đáp án ngắn
  // ("○ A. 9" → "(As"). Tìm các khối mực liền nhau dạng vòng/khung rỗng, gần vuông, nét mảnh,
  // cao gấp đôi chữ thường trở lên, rồi tô trắng cả khung (kể cả chấm/dấu tích bên trong).
  // Chữ "O", "o", "0" thật nhỏ hơn và nét dày hơn nên được giữ.
  const INK = 128;
  function findMarks(flat, w, h) {
    const label = new Int32Array(w * h);
    const stack = [];
    const comps = [];
    for (let start = 0; start < flat.length; start++) {
      if (label[start] || flat[start] >= INK) continue;
      const id = comps.length + 1;
      stack.push(start);
      label[start] = id;
      let x0 = w, y0 = h, x1 = 0, y1 = 0, n = 0;
      while (stack.length) {
        const p = stack.pop();
        const x = p % w;
        const y = (p - x) / w;
        n++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        // 8 hướng để nét mảnh, chéo của vòng tròn vẫn liền một khối
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            const q = yy * w + xx;
            if (!label[q] && flat[q] < INK) {
              label[q] = id;
              stack.push(q);
            }
          }
        }
      }
      comps.push({ id, x0, y0, x1, y1, n, cw: x1 - x0 + 1, ch: y1 - y0 + 1 });
    }

    // Cỡ chữ thường: trung vị chiều cao các khối cỡ chữ (bỏ dấu, chấm, gạch nhỏ)
    const heights = comps.filter((c) => c.n >= 20 && c.ch >= 8 && c.ch <= h / 20).map((c) => c.ch).sort((a, b) => a - b);
    const textH = heights.length ? heights[heights.length >> 1] : 0;
    if (!textH) return [];

    return comps.filter((c) => {
      const d = Math.max(c.cw, c.ch);
      if (d < 2 * textH || d > 5 * textH) return false;
      if (Math.min(c.cw, c.ch) / d < 0.85) return false; // gần vuông/tròn
      if (c.n / (c.cw * c.ch) > 0.35) return false; // nét mảnh, không phải khối đặc
      // Rỗng ở giữa: vùng 40% giữa khung không có điểm nào của chính khối này
      const ix0 = c.x0 + Math.round(c.cw * 0.3), ix1 = c.x1 - Math.round(c.cw * 0.3);
      const iy0 = c.y0 + Math.round(c.ch * 0.3), iy1 = c.y1 - Math.round(c.ch * 0.3);
      for (let y = iy0; y <= iy1; y++) for (let x = ix0; x <= ix1; x++) if (label[y * w + x] === c.id) return false;
      // Phải là thứ đứng đầu một hàng chữ: bên trái cùng hàng không có khối cỡ chữ nào
      const cy = (c.y0 + c.y1) / 2;
      return !comps.some((o) => o !== c && o.x1 < c.x0 && o.ch >= textH * 0.6 && o.n >= 20 && o.y0 < cy && o.y1 > cy);
    });
  }

  // Tô trắng các nút chọn tìm được (sửa trực tiếp trên ảnh đã làm phẳng). Trả về số nút đã xoá.
  function eraseMarks(flat, w, h) {
    const marks = findMarks(flat, w, h);
    for (const m of marks) {
      const pad = 2;
      for (let y = Math.max(0, m.y0 - pad); y <= Math.min(h - 1, m.y1 + pad); y++) {
        flat.fill(255, y * w + Math.max(0, m.x0 - pad), y * w + Math.min(w - 1, m.x1 + pad) + 1);
      }
    }
    return marks.length;
  }

  // ---------- Phóng to / thu nhỏ bằng Lanczos3 ----------
  function lanczos(x) {
    if (x === 0) return 1;
    if (x <= -LOBES || x >= LOBES) return 0;
    const px = Math.PI * x;
    return (LOBES * Math.sin(px) * Math.sin(px / LOBES)) / (px * px);
  }

  // Tính trước trọng số cho từng điểm ảnh đích trên một trục
  function weights(srcLen, dstLen) {
    const scale = dstLen / srcLen;
    const stretch = Math.max(1, 1 / scale); // thu nhỏ thì nới rộng bộ lọc để tránh răng cưa
    const support = LOBES * stretch;
    const result = [];
    for (let i = 0; i < dstLen; i++) {
      const center = (i + 0.5) / scale - 0.5;
      const from = Math.floor(center - support) + 1;
      const to = Math.floor(center + support);
      const idx = [];
      const wts = [];
      let sum = 0;
      for (let j = from; j <= to; j++) {
        const wt = lanczos((j - center) / stretch);
        if (wt === 0) continue;
        idx.push(Math.min(srcLen - 1, Math.max(0, j)));
        wts.push(wt);
        sum += wt;
      }
      result.push({ idx, wts: wts.map((wt) => wt / sum) });
    }
    return result;
  }

  function resize(gray, w, h, dw, dh) {
    if (dw === w && dh === h) return gray;
    const wx = weights(w, dw);
    const tmp = new Float32Array(dw * h);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < dw; x++) {
        const { idx, wts } = wx[x];
        let v = 0;
        for (let k = 0; k < idx.length; k++) v += gray[row + idx[k]] * wts[k];
        tmp[y * dw + x] = v;
      }
    }
    const wy = weights(h, dh);
    const out = new Float32Array(dw * dh);
    for (let y = 0; y < dh; y++) {
      const { idx, wts } = wy[y];
      for (let x = 0; x < dw; x++) {
        let v = 0;
        for (let k = 0; k < idx.length; k++) v += tmp[idx[k] * dw + x] * wts[k];
        out[y * dw + x] = v;
      }
    }
    return out;
  }

  // ---------- Tăng tương phản: kéo giãn độ sáng từ ngưỡng 1% đến 99% ra toàn dải 0–255 ----------
  function normalize(gray) {
    const hist = new Uint32Array(256);
    for (let i = 0; i < gray.length; i++) hist[Math.min(255, Math.max(0, Math.round(gray[i])))]++;
    const cut = gray.length * 0.01;
    let lo = 0;
    let hi = 255;
    for (let acc = hist[0]; lo < 255 && acc < cut; acc += hist[++lo]);
    for (let acc = hist[255]; hi > 0 && acc < cut; acc += hist[--hi]);
    const range = Math.max(1, hi - lo);
    const result = new Uint8ClampedArray(gray.length);
    for (let i = 0; i < gray.length; i++) result[i] = ((gray[i] - lo) * 255) / range;
    return result;
  }

  // ---------- API ----------
  // Bước 1 (một lần cho mỗi ảnh): xám + làm phẳng nền ở kích thước gốc
  const flatten = grayFlat;

  // Bước 2: phóng to theo tỉ lệ rồi tăng tương phản. Trả về { gray: Uint8ClampedArray, width, height }
  function render(flat, w, h, scale) {
    const dw = Math.max(1, Math.round(w * scale));
    const dh = Math.max(1, Math.round(h * scale));
    return { gray: normalize(resize(flat, w, h, dw, dh)), width: dw, height: dh };
  }

  // Chọn tỉ lệ phóng to từ chiều cao các dòng chữ đọc được ở lần đầu (kích thước gốc).
  // Lấy mức thấp (phân vị 25%) vì dòng có nút chọn, khung viền thường cao hơn chữ thật.
  // Không đo được (ảnh quá mờ/nhỏ) thì phóng to theo chiều rộng như ảnh chụp màn hình.
  function chooseScale(lineHeights, width) {
    const hs = lineHeights.filter((x) => x > 0).sort((a, b) => a - b);
    if (hs.length < 2) return Math.min(MAX_SCALE, Math.max(1, 2400 / width));
    const low = hs[Math.floor(hs.length * 0.25)];
    return Math.min(MAX_SCALE, Math.max(1, TARGET_LINE_HEIGHT / low));
  }

  const api = { flatten, render, chooseScale, eraseMarks, findMarks };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ImagePrep = api;
})(typeof window !== 'undefined' ? window : globalThis);
