// Dựng lại văn bản từ vị trí từng chữ Tesseract đọc được, theo đúng bố cục nhiều cột.
// Tesseract đọc ngang qua cả hai cột ("1) ... cứng 2) Nghiệp vụ ..."), làm lẫn đáp án/ý của hai cột.
// Ở đây: cắt mỗi dòng tại khoảng trống lớn, xác định cột theo vị trí, rồi trong mỗi hàng đọc
// hết cột trái mới sang cột phải; dòng bị xuống hàng trong cùng một cột được nối lại.
// Dùng được cả trên trình duyệt (window.Layout) lẫn Node (require).
(function (root) {
  // Dòng có độ tin cậy thấp hơn mức này là rác (sọc vân, khung viền, hình vẽ)
  const MIN_LINE_CONFIDENCE = 45;
  // Khoảng trống giữa hai chữ lớn hơn ngần này lần chiều cao chữ thì coi là sang cột khác
  const COLUMN_GAP = 2.5;
  // Khoảng cách dọc lớn hơn ngần này lần chiều cao chữ thì sang hàng/đoạn mới
  const BAND_GAP = 1.0;

  // Chữ rác lẫn trong dòng chữ thật (sọc vân, icon "X" đè lên chữ): độ tin cậy thấp.
  // Giữ lại chữ thật bị đọc dính/méo: dài từ 5 ký tự và có dấu tiếng Việt ("Trong/các", "Kỹnănggiao")
  const VN_MARK = /[̀-ͯ]|đ/iu;
  function isJunkWord(w) {
    const t = w.text.trim();
    if (w.confidence < 60 && [...t].length <= 2) return true;
    if (w.confidence >= 45) return false;
    return !([...t].length >= 5 && VN_MARK.test(t.normalize('NFD')));
  }

  const TRUE_FALSE_ROW = /^[^\p{L}]*(?:(?:đúng|sai|true|false)[^\p{L}]*)+$/iu;

  function median(values) {
    const s = [...values].sort((a, b) => a - b);
    return s.length ? s[s.length >> 1] : 0;
  }

  // blocks: data.blocks của Tesseract.js. Trả về văn bản; đoạn/hàng cách nhau bằng dòng trống.
  function toText(blocks) {
    const lines = (blocks || [])
      .flatMap((b) => b.paragraphs.flatMap((p) => p.lines))
      .filter((l) => l.confidence >= MIN_LINE_CONFIDENCE && l.words.length);
    if (!lines.length) return '';

    const wordH = median(lines.flatMap((l) => l.words.map((w) => w.bbox.y1 - w.bbox.y0))) || 20;
    const width = Math.max(...lines.map((l) => l.bbox.x1));

    // 1. Cắt mỗi dòng thành các đoạn tại khoảng trống lớn
    const segs = [];
    for (const line of lines) {
      let cur = null;
      for (const w of [...line.words].sort((a, b) => a.bbox.x0 - b.bbox.x0)) {
        const text = w.text.trim();
        if (!text || isJunkWord(w)) continue;
        if (!cur || w.bbox.x0 - cur.x1 > COLUMN_GAP * wordH) {
          cur = { words: [], x0: w.bbox.x0, x1: w.bbox.x1, y0: w.bbox.y0, y1: w.bbox.y1, first: !cur };
          segs.push(cur);
        }
        cur.words.push(text);
        cur.x1 = Math.max(cur.x1, w.bbox.x1);
        cur.y0 = Math.min(cur.y0, w.bbox.y0);
        cur.y1 = Math.max(cur.y1, w.bbox.y1);
      }
    }

    // 2. Tìm vị trí bắt đầu các cột: nơi các đoạn "giữa dòng" (sau khoảng trống lớn) cùng bắt đầu.
    //    - Các vị trí gần nhau (chữ cái đáp án và chữ sau ô chọn) gộp thành một cột
    //    - Cột phải cách mép trái và cách nhau ít nhất 20% chiều rộng (khoảng trống chỗ ô chọn
    //      ngay sau "A", "B" không phải ranh giới cột)
    //    - Bỏ qua đoạn lẻ chỉ có 1 chữ (biểu tượng, nút ở góc màn hình)
    const tol = width * 0.12;
    const minColumn = width * 0.2;
    const starts = segs.filter((s) => !s.first && s.x0 >= minColumn).sort((a, b) => a.x0 - b.x0);
    const clusters = [];
    for (const s of starts) {
      const last = clusters[clusters.length - 1];
      if (last && s.x0 - last[last.length - 1].x0 <= tol) last.push(s);
      else clusters.push([s]);
    }
    const bounds = [];
    for (const c of clusters) {
      if (c.length < 2 && c.every((s) => s.words.length < 2)) continue;
      const b = c[0].x0 - width * 0.02;
      if (!bounds.length || b - bounds[bounds.length - 1] >= minColumn) bounds.push(b);
    }
    const colOf = (s) => bounds.filter((b) => s.x0 >= b).length;

    // 3. Chia thành các hàng (band) theo khoảng trống dọc
    segs.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
    const bands = [];
    let bottom = -Infinity;
    for (const s of segs) {
      if (!bands.length || s.y0 > bottom + BAND_GAP * wordH) bands.push([]);
      bands[bands.length - 1].push(s);
      bottom = Math.max(bottom, s.y1);
    }

    // 4. Trong mỗi hàng: đọc từng cột từ trên xuống; các đoạn cùng dòng trong một cột ghép lại;
    //    dòng bắt đầu bằng chữ thường là phần xuống hàng của dòng trên thì nối vào
    const out = bands.map((band) => {
      const cols = [];
      for (const s of band) (cols[colOf(s)] = cols[colOf(s)] || []).push(s);
      const result = [];
      for (const col of cols.filter(Boolean)) {
        const rows = [];
        for (const s of col.sort((a, b) => a.y0 - b.y0)) {
          const row = rows[rows.length - 1];
          const center = (s.y0 + s.y1) / 2;
          if (row && center > row.y0 && center < row.y1) {
            row.segs.push(s);
            row.y1 = Math.max(row.y1, s.y1);
          } else {
            rows.push({ y0: s.y0, y1: s.y1, segs: [s] });
          }
        }
        const texts = rows.map((r) =>
          r.segs
            .sort((a, b) => a.x0 - b.x0)
            .map((s) => s.words.join(' '))
            .join(' ')
        );
        const merged = [];
        for (const t of texts) {
          const prev = merged[merged.length - 1];
          const continues =
            prev !== undefined &&
            !/[?:]$/.test(prev) &&
            /^\p{Ll}/u.test(t) &&
            !/^[a-h][.)]?\s/u.test(t) &&
            !TRUE_FALSE_ROW.test(t); // hàng nút "sai @ Đúng" không phải phần xuống hàng
          if (continues) merged[merged.length - 1] = `${prev} ${t}`;
          else merged.push(t);
        }
        result.push(...merged);
      }
      return result.join('\n');
    });
    return out.join('\n\n');
  }

  const api = { toText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Layout = api;
})(typeof window !== 'undefined' ? window : globalThis);
