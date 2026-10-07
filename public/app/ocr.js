// Nhận dạng chữ ngay trên trình duyệt bằng Tesseract.js (không gửi ảnh lên server).
(function (root) {
  const LANGS = 'vie+eng';
  // Ảnh chụp màn hình thường có chữ quá nhỏ so với mức Tesseract đọc tốt: phóng to, chuyển xám,
  // tăng tương phản. Đo trên ảnh đề trắc nghiệm: ảnh gốc sai 19 từ, phóng to 3 lần sai 0 từ.
  const MAX_SCALE = 3;
  const SCALE_WIDTH = 6000; // ảnh rộng hơn 2000px (ảnh chụp điện thoại) phóng ít dần, từ 6000px thì giữ nguyên
  const MAX_PIXELS = 16e6; // Safari trên iPhone giới hạn canvas khoảng 16,7 triệu điểm ảnh

  let workerPromise = null;
  let onProgress = null; // (message) => void, dùng để báo tiến độ tải dữ liệu lần đầu

  const STATUS_TEXT = {
    'loading tesseract core': 'Đang tải bộ nhận dạng chữ',
    'loading language traineddata': 'Đang tải dữ liệu tiếng Việt và tiếng Anh (chỉ lần đầu)',
    'initializing api': 'Đang khởi động bộ nhận dạng',
  };

  function getWorker() {
    if (!workerPromise) {
      workerPromise = Tesseract.createWorker(LANGS, 1, {
        logger: (m) => {
          const label = STATUS_TEXT[m.status];
          if (label && onProgress) onProgress(`${label}… ${Math.round((m.progress || 0) * 100)}%`);
        },
      }).catch((err) => {
        workerPromise = null;
        throw err;
      });
    }
    return workerPromise;
  }

  function canvasOf(w, h) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    return [canvas, canvas.getContext('2d', { willReadFrequently: true })];
  }

  async function preprocess(file) {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    // Ảnh gốc quá lớn thì cho trình duyệt thu nhỏ trước (thu nhỏ không làm hỏng chữ)
    const shrink = Math.min(1, Math.sqrt(MAX_PIXELS / (bmp.width * bmp.height)));
    const sw = Math.round(bmp.width * shrink);
    const sh = Math.round(bmp.height * shrink);
    const [, srcCtx] = canvasOf(sw, sh);
    srcCtx.drawImage(bmp, 0, 0, sw, sh);
    bmp.close();

    let scale = Math.min(MAX_SCALE, Math.max(1, SCALE_WIDTH / sw));
    if (sw * sh * scale * scale > MAX_PIXELS) scale = Math.max(1, Math.sqrt(MAX_PIXELS / (sw * sh)));
    const dw = Math.round(sw * scale);
    const dh = Math.round(sh * scale);

    // Phóng to bằng Lanczos3 tự tính (giống nhau trên mọi trình duyệt), chuyển xám, tăng tương phản
    const { gray } = ImagePrep.prepare(srcCtx.getImageData(0, 0, sw, sh).data, sw, sh, dw, dh);
    const [canvas, ctx] = canvasOf(dw, dh);
    const out = ctx.createImageData(dw, dh);
    for (let i = 0, p = 0; p < gray.length; i += 4, p++) {
      out.data[i] = out.data[i + 1] = out.data[i + 2] = gray[p];
      out.data[i + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);
    return canvas;
  }

  async function recognize(file) {
    const worker = await getWorker();
    const canvas = await preprocess(file);
    const { data } = await worker.recognize(canvas);
    return FixText.fixMergedSyllables(data.text).trim();
  }

  root.OCR = {
    recognize,
    preload: () => getWorker(),
    setProgressListener: (fn) => (onProgress = fn),
  };
})(window);
