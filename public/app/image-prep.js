// Tiền xử lý ảnh trước khi OCR: chuyển xám, phóng to bằng bộ lọc Lanczos3, tăng tương phản.
// Tự tính toán thay vì để trình duyệt phóng to, vì mỗi trình duyệt phóng to một kiểu và
// kết quả OCR kém đi rõ rệt. Dùng được cả trên trình duyệt (window.ImagePrep) lẫn Node (require).
(function (root) {
  const LOBES = 3;

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

  // rgba: Uint8ClampedArray (w*h*4). Trả về { gray: Uint8ClampedArray (dw*dh), width, height }
  function prepare(rgba, w, h, dw, dh) {
    // 1. Chuyển xám (độ sáng theo chuẩn Rec. 709), nền trong suốt coi như trắng
    const gray = new Float32Array(w * h);
    for (let i = 0, p = 0; p < gray.length; i += 4, p++) {
      const a = rgba[i + 3] / 255;
      const y = 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
      gray[p] = y * a + 255 * (1 - a);
    }

    // 2. Phóng to theo chiều ngang rồi chiều dọc
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

    // 3. Tăng tương phản: kéo giãn độ sáng từ ngưỡng 1% đến 99% ra toàn dải 0–255
    const hist = new Uint32Array(256);
    for (let i = 0; i < out.length; i++) hist[Math.min(255, Math.max(0, Math.round(out[i])))]++;
    const cut = out.length * 0.01;
    let lo = 0;
    let hi = 255;
    for (let acc = hist[0]; lo < 255 && acc < cut; acc += hist[++lo]);
    for (let acc = hist[255]; hi > 0 && acc < cut; acc += hist[--hi]);
    const range = Math.max(1, hi - lo);
    const result = new Uint8ClampedArray(out.length);
    for (let i = 0; i < out.length; i++) result[i] = ((out[i] - lo) * 255) / range;

    return { gray: result, width: dw, height: dh };
  }

  const api = { prepare };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ImagePrep = api;
})(typeof window !== 'undefined' ? window : globalThis);
