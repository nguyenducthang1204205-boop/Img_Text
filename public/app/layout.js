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
  // Toạ độ / chỉ số như "I'(2,2)", "(1,2)": Tesseract hay đọc đúng nhưng chấm độ tin cậy rất thấp
  const COORD_RE = /\(\s*-?\d{1,3}\s*[,;]\s*-?\d{1,3}\s*\)/;
  function isJunkWord(w) {
    const t = w.text.trim();
    if (COORD_RE.test(t)) return false;
    if (w.confidence < 60 && [...t].length <= 2) return true;
    if (w.confidence >= 45) return false;
    return !([...t].length >= 5 && VN_MARK.test(t.normalize('NFD')));
  }

  const TRUE_FALSE_ROW = /^[^\p{L}]*(?:(?:đúng|sai|true|false)[^\p{L}]*)+$/iu;

  function median(values) {
    const s = [...values].sort((a, b) => a - b);
    return s.length ? s[s.length >> 1] : 0;
  }

  // Dòng công thức / ma trận: không có từ nào (từ 2 chữ cái trở lên), có số hoặc ký hiệu toán học.
  // Không tính dòng đáp án ("A. 9"), số trang ("10/15") và giờ ("12:09").
  function isMathLine(t) {
    return (
      !t.includes('⟦') && // đã là hình
      !/\p{L}{2,}/u.test(t) &&
      /[\d=+\-−×÷^√∑∫]/u.test(t) &&
      !/^\s*[A-Ha-h]\s*[.):,]/u.test(t) &&
      !/^\s*\d{1,4}\s*\/\s*\d{1,4}\s*$/.test(t) &&
      !/^\s*\d{1,2}:\d{2}/.test(t)
    );
  }

  // blocks: data.blocks của Tesseract.js. Trả về văn bản; đoạn/hàng cách nhau bằng dòng trống.
  // figures (không bắt buộc): mảng các vùng hình { x0, y0, x1, y1, wordH } theo toạ độ ảnh đưa vào
  // Tesseract. Vùng có sẵn khi gọi (ma trận tìm theo cặp ngoặc) được dùng trước: chữ đọc được bên trong
  // bị bỏ, thay bằng "⟦k⟧" (k là vị trí trong mảng) đúng chỗ đó, nên "A." cùng hàng thành "A. ⟦k⟧".
  // Hàm còn tự thêm vùng cho công thức nhiều dòng không có ngoặc.
  // marks (không bắt buộc): vị trí các nút chọn đã xoá khỏi ảnh, cùng hệ toạ độ.
  function toText(blocks, figures, marks = []) {
    const presets = figures ? figures.slice() : [];
    const lines = (blocks || [])
      .flatMap((b) => b.paragraphs.flatMap((p) => p.lines))
      .filter((l) => l.confidence >= MIN_LINE_CONFIDENCE && l.words.length);
    if (!lines.length && !presets.length) return '';

    const wordH = median(lines.flatMap((l) => l.words.map((w) => w.bbox.y1 - w.bbox.y0))) || 20;
    const width = Math.max(1, ...lines.map((l) => l.bbox.x1));
    presets.forEach((f) => (f.wordH = f.wordH || wordH));
    // Nhãn đáp án đứng trước ma trận ("C. (…)"). Khung nới sang trái để lấy nhãn ma trận ("S0 =")
    // có thể lấy luôn "C.", và OCR hay đọc dính nhãn với ngoặc ("c|-1") hoặc đọc sai ("D." → "5").
    // Từ đầu tiên của hàng, bắt đầu bên trái ngoặc mở (bx0):
    //   - bắt đầu bằng chữ cái A–H rồi tới dấu / ngoặc ("C.", "c|-1") và không phải "A =" → nhãn đáp án;
    //   - chỉ 1–2 ký tự không phải chữ ("5") → nhãn đọc sai, đoán theo đáp án trước ("⟨?⟩", xử lý cuối hàm).
    // Khung cắt thu lại về mép ngoặc để hình không chứa nhãn; nhãn thành chữ đứng trước hình.
    const labelWords = new Set();
    const labelSegs = [];
    for (const f of presets) {
      if (f.bx0 === undefined) continue;
      for (const l of lines) {
        const words = [...l.words].sort((a, b) => a.bbox.x0 - b.bbox.x0);
        const i = words.findIndex((w) => {
          const cy = (w.bbox.y0 + w.bbox.y1) / 2;
          return cy >= f.y0 && cy <= f.y1 && w.bbox.x0 < f.bx0 && f.bx0 - w.bbox.x1 < 8 * wordH;
        });
        // Phải là từ đầu tiên của dòng (trước nó chỉ có thể là vụn của nút chọn)
        if (i < 0 || words.slice(0, i).some((w) => /\p{L}{2}|\d/u.test(w.text))) continue;
        const t = words[i].text.trim();
        const next = (words[i + 1] && words[i + 1].text.trim()) || '';
        const m = /^\(?([A-Ha-h])(?:[.):,|]|$)/u.exec(t);
        let label = null;
        if (m && !t.includes('=') && !next.startsWith('=')) label = `${m[1]}.`;
        else if (!/\p{L}/u.test(t) && [...t].length <= 2 && !t.includes('=')) label = '⟨?⟩';
        if (!label) continue;
        f.labeled = true;
        const w = words[i];
        labelWords.add(w);
        labelSegs.push({ words: [label], x0: w.bbox.x0, x1: Math.min(w.bbox.x1, f.bx0), y0: w.bbox.y0, y1: w.bbox.y1, first: true });
        f.x0 = Math.max(f.x0, f.bx0 - 0.3 * wordH);
      }
      // Không đọc được nhãn nhưng cùng hàng có nút chọn ở bên trái: chắc chắn là một đáp án
      const mark = !f.labeled && marks.find((k) => (k.y0 + k.y1) / 2 >= f.y0 && (k.y0 + k.y1) / 2 <= f.y1 && k.x1 < f.bx0);
      if (mark) {
        const cy = (mark.y0 + mark.y1) / 2;
        labelSegs.push({ words: ['⟨?⟩'], x0: mark.x1 + 1, x1: mark.x1 + wordH, y0: cy - wordH / 2, y1: cy + wordH / 2, first: true });
        f.x0 = Math.max(f.x0, f.bx0 - 0.3 * wordH);
      }
    }
    const inPreset = (b) => {
      const cx = (b.x0 + b.x1) / 2;
      const cy = (b.y0 + b.y1) / 2;
      return presets.some((f) => cx >= f.x0 && cx <= f.x1 && cy >= f.y0 && cy <= f.y1);
    };

    // 1. Cắt mỗi dòng thành các đoạn tại khoảng trống lớn
    const segs = presets.map((f, k) => ({ words: [`⟦${k}⟧`], x0: f.x0, x1: f.x1, y0: f.y0, y1: f.y1, first: true }));
    segs.push(...labelSegs);
    for (const line of lines) {
      let cur = null;
      for (const w of [...line.words].sort((a, b) => a.bbox.x0 - b.bbox.x0)) {
        const text = w.text.trim();
        if (!text || isJunkWord(w) || inPreset(w.bbox) || labelWords.has(w)) continue;
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

    const bandBox = bands.map((band) => ({
      y0: Math.min(...band.map((s) => s.y0)),
      y1: Math.max(...band.map((s) => s.y1)),
    }));
    // Vùng hình: bao quanh các dòng, nới rộng để lấy cả ngoặc ma trận và nhãn "I =" (thường không
    // đọc được thành chữ), nhưng không lấn sang hàng chữ phía trên / dưới
    const figureToken = (lines, b) => {
      const padX = 1.5 * wordH; // ocr.js còn nới tiếp theo nội dung (nhãn "I =", ngoặc)
      const padY = 0.7 * wordH;
      const above = b > 0 ? bandBox[b - 1].y1 + 2 : 0;
      const below = b < bands.length - 1 ? bandBox[b + 1].y0 - 2 : Infinity;
      figures.push({
        x0: Math.max(0, Math.min(...lines.map((l) => l.x0)) - padX),
        x1: Math.max(...lines.map((l) => l.x1)) + padX,
        y0: Math.max(above, Math.min(...lines.map((l) => l.y0)) - padY),
        y1: Math.min(below, Math.max(...lines.map((l) => l.y1)) + padY),
        wordH,
      });
      return `⟦${figures.length - 1}⟧`;
    };

    // 4. Trong mỗi hàng: đọc từng cột từ trên xuống; các đoạn cùng dòng trong một cột ghép lại;
    //    dòng bắt đầu bằng chữ thường là phần xuống hàng của dòng trên thì nối vào
    const out = bands.map((band, b) => {
      const cols = [];
      for (const s of band) (cols[colOf(s)] = cols[colOf(s)] || []).push(s);
      const colLines = [];
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
        const texts = rows.map((r) => {
          let segs = r.segs.sort((a, b) => a.x0 - b.x0);
          // Hàng có hình: chỉ giữ hình và nhãn đáp án đứng trước nó; chữ vụn khác cùng hàng (đường kẻ
          // nét đứt đọc thành "ee:", số hàng ma trận lọt ra ngoài khung…) bỏ đi
          const fig = segs.find((s) => s.words[0].startsWith('⟦'));
          if (fig) {
            segs = segs.filter(
              (s) => s === fig || (s.x1 <= fig.x0 + wordH && /^(?:⟨\?⟩|\(?[A-Ha-h][.):,]?)$/u.test(s.words.join(' ')))
            );
          }
          return {
            t: segs.map((s) => s.words.join(' ')).join(' '),
            x0: Math.min(...segs.map((s) => s.x0)),
            x1: Math.max(...segs.map((s) => s.x1)),
            y0: r.y0,
            y1: r.y1,
          };
        });
        const merged = [];
        for (const l of texts) {
          const prev = merged[merged.length - 1];
          const continues =
            prev !== undefined &&
            !prev.t.includes('⟦') && // dòng hình không bao giờ "xuống hàng"
            !/[?:]$/.test(prev.t) &&
            /^\p{Ll}/u.test(l.t) &&
            !/^[a-h][.)]?\s/u.test(l.t) &&
            !TRUE_FALSE_ROW.test(l.t); // hàng nút "sai @ Đúng" không phải phần xuống hàng
          if (continues) {
            prev.t = `${prev.t} ${l.t}`;
            prev.x0 = Math.min(prev.x0, l.x0);
            prev.x1 = Math.max(prev.x1, l.x1);
            prev.y1 = Math.max(prev.y1, l.y1);
          } else merged.push({ ...l });
        }
        colLines.push(merged);
      }

      const all = colLines.flat();
      if (!figures) return all.map((l) => l.t).join('\n');
      // Cả hàng là ma trận / công thức nhiều dòng (kể cả hai ma trận cạnh nhau): một hình
      if (all.length >= 2 && all.every((l) => isMathLine(l.t))) return figureToken(all, b);
      // Hàng lẫn chữ: từ 2 dòng công thức liền nhau trong cùng một cột trở lên thì thành hình
      const result = [];
      for (const lines of colLines) {
        let run = [];
        const flush = () => {
          if (run.length >= 2) result.push(figureToken(run, b));
          else result.push(...run.map((l) => l.t));
          run = [];
        };
        for (const l of lines) {
          if (isMathLine(l.t)) run.push(l);
          else {
            flush();
            result.push(l.t);
          }
        }
        flush();
      }
      return result.join('\n');
    });
    // Nhãn đáp án đọc sai trước ma trận ("⟨?⟩ ⟦k⟧"): là chữ cái tiếp theo sau đáp án gần nhất bên trên;
    // chưa có đáp án nào thì bỏ nhãn
    let lastLetter = null;
    return out
      .join('\n\n')
      .split('\n')
      .map((line) => {
        const m = /^\s*([A-Ha-h])[.):,]/u.exec(line);
        if (m) lastLetter = m[1].toUpperCase();
        if (!line.startsWith('⟨?⟩')) return line;
        if (!lastLetter || lastLetter === 'H') return line.replace(/^⟨\?⟩\s*/, '');
        lastLetter = String.fromCharCode(lastLetter.charCodeAt(0) + 1);
        return line.replace('⟨?⟩', `${lastLetter}.`);
      })
      .join('\n');
  }

  const api = { toText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Layout = api;
})(typeof window !== 'undefined' ? window : globalThis);
