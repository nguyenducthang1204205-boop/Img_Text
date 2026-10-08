// Nhận dạng chữ ngay trên trình duyệt bằng Tesseract.js (không gửi ảnh lên server).
(function (root) {
  const LANGS = 'vie+eng';
  const MAX_PIXELS = 16e6; // Safari trên iPhone giới hạn canvas khoảng 16,7 triệu điểm ảnh
  const MIN_RESCALE = 1.3; // chỉ đọc lại khi cần phóng to đáng kể

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

  // Đọc ảnh vào và chuyển xám + làm phẳng nền (bỏ sọc vân, nền loang màu) ở kích thước gốc
  async function loadFlat(file) {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    // Ảnh gốc quá lớn thì cho trình duyệt thu nhỏ trước (thu nhỏ không làm hỏng chữ)
    const shrink = Math.min(1, Math.sqrt(MAX_PIXELS / (bmp.width * bmp.height)));
    const w = Math.round(bmp.width * shrink);
    const h = Math.round(bmp.height * shrink);
    const [, ctx] = canvasOf(w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    return { flat: ImagePrep.flatten(ctx.getImageData(0, 0, w, h).data, w, h), w, h };
  }

  // Phóng to bằng Lanczos3 tự tính (giống nhau trên mọi trình duyệt), tăng tương phản, vẽ ra canvas
  function renderCanvas({ flat, w, h }, scale) {
    const { gray, width, height } = ImagePrep.render(flat, w, h, scale);
    const [canvas, ctx] = canvasOf(width, height);
    const out = ctx.createImageData(width, height);
    for (let i = 0, p = 0; p < gray.length; i += 4, p++) {
      out.data[i] = out.data[i + 1] = out.data[i + 2] = gray[p];
      out.data[i + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);
    return canvas;
  }

  // Chiều cao các dòng chữ đọc được chắc chắn (để biết cỡ chữ trong ảnh)
  function lineHeights(data) {
    return (data.blocks || [])
      .flatMap((b) => b.paragraphs.flatMap((p) => p.lines))
      .filter((l) => l.confidence >= 60 && l.text.trim().length >= 4)
      .map((l) => l.bbox.y1 - l.bbox.y0);
  }

  // Lượt 1 đọc ở kích thước gốc để đo cỡ chữ; chữ nhỏ (ảnh chụp màn hình) thì phóng to
  // cho dòng chữ cao khoảng 48px rồi đọc lượt 2. Ảnh chụp có chữ đủ lớn thì dùng luôn lượt 1.
  async function recognize(file) {
    const worker = await getWorker();
    const img = await loadFlat(file);
    const first = (await worker.recognize(renderCanvas(img, 1), {}, { text: true, blocks: true })).data;
    let scale = ImagePrep.chooseScale(lineHeights(first), img.w);
    scale = Math.min(scale, Math.sqrt(MAX_PIXELS / (img.w * img.h)));
    let text = first.text;
    if (scale >= MIN_RESCALE) text = (await worker.recognize(renderCanvas(img, scale))).data.text;
    return FixText.fixMergedSyllables(text).trim();
  }

  root.OCR = {
    recognize,
    preload: () => getWorker(),
    setProgressListener: (fn) => (onProgress = fn),
  };
})(window);
