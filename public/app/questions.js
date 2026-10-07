// Tách câu hỏi, đánh số tự động và lọc câu hỏi trùng.
// Dùng được cả trên trình duyệt (window.Questions) lẫn Node (require).
(function (root) {
  // "Câu 1:", "Câu hỏi 2.", "Bài 3)", "Question 4 -", "CÂU 5"... và "Câu:" khi OCR làm mất số
  const KEYWORD_RE = /^\s*(?:câu\s*hỏi|cau\s*hoi|câu|cau|question|bài|bai)\s*(?:\d{1,4}\s*[:.)\-–]?|[:.])\s*/iu;
  // "1.", "2)", "3:" ở đầu dòng (chỉ dùng khi ảnh không có dạng "Câu N")
  const NUMBER_RE = /^\s*\d{1,4}\s*[.):]\s+(?=\S)/u;

  // Dòng đáp án: "A. ...", "B) ...", "c. ...", "A, ..." (OCR hay đọc "." thành ",")
  const OPTION_RE = /^\s*(?:[A-H]\s*[.):,]|[a-h]\s*[.)])/u;
  // Dòng đi kèm câu hỏi, không bao giờ là câu mới
  const FOLLOW_RE = /^\s*(?:đáp\s*án|dap\s*an|giải\s*thích|lời\s*giải|hướng\s*dẫn|answer|explanation)\b/iu;

  // Nhãn số câu bị OCR đọc sai thành chữ lẫn số, ví dụ "Ø888x: Điện toán..."
  const JUNK_LABEL_RE = /^\s*(?=[^\s:]*\d)(?=[^\s:]*[^\d\s:])[^\s:]{2,8}\s*:\s+(?=\S)/u;

  const isOption = (line) => OPTION_RE.test(line);

  // Câu trả lời ngắn có nghĩa, không được coi là rác
  const SHORT_ANSWER_RE = /^(?:đúng|sai|true|false|có|không|yes|no)$/iu;

  // Dòng rác ngắn do OCR đọc nhầm khung viền, nhãn màu...: chỉ một cụm ký tự ≤ 5
  // ("ET", "Em;", "|", "Guz |", "| Giu3 |", "e4 |", "<", ">")
  function isNoise(line) {
    if (!line.trim() || line.includes('?')) return false;
    if (isOption(line) || KEYWORD_RE.test(line) || NUMBER_RE.test(line)) return false;
    const t = line.replace(/[|_~\-–—•·]+/g, '').trim();
    if (SHORT_ANSWER_RE.test(t)) return false;
    return t.length <= 5 && !/\s/.test(t);
  }

  // ---------- Dọn chữ từ ảnh chụp màn hình app/web làm bài ----------
  // Nút tròn chọn đáp án bị OCR đọc thành "O", "QO", "Ø", "Ở", "(Ò"... trước "A."
  const RADIO_RE = /^\s*[OoQ0ØøÔôỞởÒòƠơỌọ©®@○●◯◉•()[\]Cc]{1,3}\s+(?=(?:[A-H]|8)\s*[.):])/u;
  // Thanh trạng thái điện thoại: "14:34 ...", tiêu đề kèm đồng hồ đếm giờ: "Kiểm tra tuần 14:58"
  const CLOCK_START_RE = /^\s*\d{1,2}:\d{2}(?!\d)/;
  const CLOCK_END_RE = /(?<!\d)\d{1,2}:\d{2}(?::\d{2})?\s*$/;
  // Số trang: "1/15", "Câu 1/15", "Câu hỏi 1 / 15"
  const PAGER_RE = /^\s*(?:(?:câu\s*hỏi|câu|question)\s*)?\d{1,4}\s*\/\s*\d{1,4}\s*$/iu;
  // Nhãn/nút giao diện đứng một mình
  const UI_LABEL_RE =
    /^\s*(?:câu\s*hỏi|(?:trả\s*lời|chọn\s*(?:một\s*)?đáp\s*án(?:\s*đúng)?|đáp\s*án|câu\s*trước|câu\s*sau|câu\s*tiếp(?:\s*theo)?|tiếp\s*theo|quay\s*lại|nộp\s*bài|kết\s*thúc|next|previous|back|submit)\s*:?)\s*$/iu;

  // Dòng rác do OCR đọc ma trận, hình vẽ, công thức dạng ảnh ("0-I0", "T;= -1 4 -1", "0 -1 0"):
  // không có chữ nào (từ 2 chữ cái trở lên), không có "?" và không phải phép tính rõ ràng
  function isFormulaJunk(line) {
    if (/\?/.test(line) || /\p{L}{2,}/u.test(line)) return false;
    return !isCleanEquation(line);
  }

  // Phép tính rõ ràng như "2x + 3 = 7": có dấu "=", chỉ gồm ký tự toán học, ngoặc cân bằng,
  // không có "|" hay chữ "I" đứng một mình (dấu hiệu OCR đọc nhầm ngoặc ma trận)
  function isCleanEquation(line) {
    if (!/=/.test(line) || !/^[\p{L}\p{N}\s+\-−*/^=().,<>≤≥×÷²³√%]+$/u.test(line)) return false;
    if (/(?<!\p{L})I(?!\p{L})/u.test(line)) return false;
    let depth = 0;
    for (const ch of line) {
      if (ch === '(') depth++;
      else if (ch === ')' && --depth < 0) return false;
    }
    return depth === 0;
  }

  function isUiLine(line) {
    const t = line.trim();
    if (!t || isOption(t) || t.includes('?')) return false;
    if (PAGER_RE.test(t) || UI_LABEL_RE.test(t)) return true;
    if (CLOCK_START_RE.test(t) && t.length <= 30) return true;
    if (CLOCK_END_RE.test(t) && t.length <= 40) return true;
    return isFormulaJunk(t);
  }

  // Làm sạch từng dòng, bỏ dòng giao diện/rác. Giữ dòng trống (dùng để nhận biết đoạn văn).
  function cleanLines(lines) {
    const out = [];
    let prevLetter = null;
    for (let line of lines) {
      line = line.replace(RADIO_RE, '');
      // "B." hay bị đọc thành "8."
      if (prevLetter === 'A' && /^\s*8\s*[.):]/.test(line)) line = line.replace(/^(\s*)8/, '$1B');
      if (!line.trim()) {
        out.push('');
        continue;
      }
      if (isUiLine(line) || isNoise(line)) continue;
      const m = /^\s*([A-H])\s*[.):,]/.exec(line);
      prevLetter = m ? m[1] : isOption(line) ? prevLetter : null;
      out.push(line);
    }
    return out;
  }

  // Trả về { intro, continuation, questions: [{ raw, body }] }
  // intro: phần chữ trước câu hỏi đầu tiên (tiêu đề đề thi...), giữ nguyên.
  // continuation: ảnh bắt đầu bằng đáp án => phần đáp án tràn từ câu cuối của ảnh trước.
  function splitQuestions(text) {
    const lines = cleanLines(String(text || '').replace(/\r\n?/g, '\n').split('\n'));
    const marker = lines.some((l) => KEYWORD_RE.test(l))
      ? KEYWORD_RE
      : lines.some((l) => NUMBER_RE.test(l))
        ? NUMBER_RE
        : null;
    const hasOptions = lines.some(isOption);

    const intro = [];
    const questions = [];
    let current = null;
    let prevBlank = true;
    for (const line of lines) {
      if (!line.trim()) {
        prevBlank = true;
        continue;
      }
      let starts;
      if (marker) {
        // Có số câu ("Câu 1", "1."...): câu mới bắt đầu ở mỗi dòng có số
        starts = marker.test(line);
      } else if (hasOptions) {
        // Không có số câu nhưng có đáp án A/B/C/D: câu mới là dòng không phải đáp án
        // xuất hiện sau nhóm đáp án của câu trước
        const plain = !isOption(line) && !FOLLOW_RE.test(line);
        if (plain && current && !current.hasOption && prevBlank) {
          // Đoạn chữ phía trên chưa có đáp án mà đã cách một dòng trống:
          // kết thúc bằng "?" thì là câu hỏi không có đáp án, giữ lại;
          // còn nếu nằm đầu ảnh thì là tiêu đề đề thi..., không phải câu hỏi
          if (/[?？]$/.test(current.raw[current.raw.length - 1].trim())) {
            current.closed = true;
          } else if (questions.length === 1) {
            questions.pop();
            intro.push(...current.raw);
            current = null;
          }
        }
        starts = plain && (!current || current.hasOption || current.closed);
      } else {
        // Không có số câu lẫn đáp án: mỗi đoạn văn là một câu
        starts = prevBlank;
      }

      if (starts) {
        const body = marker ? line.replace(marker, '') : line.replace(JUNK_LABEL_RE, '');
        current = { raw: [line], body: [body], hasOption: false };
        questions.push(current);
      } else if (current) {
        current.raw.push(line);
        current.body.push(line);
        if (isOption(line)) current.hasOption = true;
      } else {
        intro.push(line);
      }
      prevBlank = false;
    }

    return {
      intro: intro.join('\n').trim(),
      continuation: intro.length > 0 && isOption(intro[0]),
      questions: questions.map((q) => ({ raw: q.raw.join('\n').trim(), body: q.body.join('\n').trim() })),
    };
  }

  // Chuẩn hoá để so sánh: chữ thường, bỏ dấu câu và khoảng trắng thừa
  function normalize(s) {
    return String(s).normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  }

  function bigrams(s) {
    const map = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const b = s.slice(i, i + 2);
      map.set(b, (map.get(b) || 0) + 1);
    }
    return map;
  }

  // Độ giống nhau 0..1 (hệ số Dice trên cặp ký tự), chịu được lỗi OCR nhỏ
  function similarity(a, b) {
    if (a === b) return 1;
    if (a.length < 2 || b.length < 2) return 0;
    const A = bigrams(a);
    const B = bigrams(b);
    let inter = 0;
    for (const [k, c] of A) inter += Math.min(c, B.get(k) || 0);
    return (2 * inter) / (a.length - 1 + (b.length - 1));
  }

  // items: [{ name, index, text }]
  // opts: { number, format ("Câu {n}:"), dedupe, threshold (0..1) }
  // Trả về { blocks: [{ name, index, text }], questions: [text] (null nếu tắt cả hai chức năng), total,
  //          removed: [{ text, index, name, duplicateOf, score }] }
  function processItems(items, opts = {}) {
    const { number = true, format = 'Câu {n}:', dedupe = true, threshold = 0.9 } = opts;
    if (!number && !dedupe) {
      return { blocks: items.map((it) => ({ ...it })), questions: null, total: null, removed: [] };
    }

    const kept = []; // { norm, no }
    const removed = [];
    let n = 0;
    // Câu gần nhất: { parts, i } nếu được giữ, { removed } nếu bị loại vì trùng
    let last = null;
    const keptRefs = [];

    const partsList = items.map((item) => {
      const { intro, continuation, questions } = splitQuestions(item.text);
      const parts = [];

      if (intro) {
        if (continuation && last && last.parts) last.parts[last.i] += '\n' + intro;
        else if (continuation && last && last.removed) last.removed.text += '\n' + intro;
        else parts.push(intro);
      }

      for (const q of questions) {
        const norm = normalize(q.body);
        if (dedupe && norm) {
          let match = null;
          let best = 0;
          for (const k of kept) {
            // Chênh lệch độ dài quá lớn thì không thể đạt ngưỡng, bỏ qua cho nhanh
            const ratio = (2 * Math.min(norm.length, k.norm.length)) / (norm.length + k.norm.length);
            if (ratio < threshold) continue;
            const s = similarity(norm, k.norm);
            if (s >= threshold && s > best) {
              best = s;
              match = k;
            }
          }
          if (match) {
            const r = { text: q.raw, index: item.index, name: item.name, duplicateOf: match.no, score: best };
            removed.push(r);
            last = { removed: r };
            continue;
          }
        }
        n++;
        kept.push({ norm, no: n });
        parts.push(number ? `${format.replace('{n}', n)} ${q.body}` : q.raw);
        last = { parts, i: parts.length - 1 };
        keptRefs.push(last);
      }

      return parts;
    });

    // Ghép văn bản sau cùng vì phần đáp án tràn có thể được nối vào khối của ảnh trước
    const blocks = items.map((item, k) => ({ name: item.name, index: item.index, text: partsList[k].join('\n\n') }));
    // Chỉ các câu hỏi được giữ lại (không có tiêu đề/phần chữ ngoài câu hỏi), theo thứ tự
    const questions = keptRefs.map((r) => r.parts[r.i]);
    return { blocks, questions, total: n, removed };
  }

  const api = { splitQuestions, normalize, similarity, processItems };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Questions = api;
})(typeof window !== 'undefined' ? window : globalThis);
