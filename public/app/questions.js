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

  // ---------- Đáp án dạng bảng / nhiều đáp án trên một dòng ----------
  // Ký tự do nút tròn, ô vuông chọn, vạch ngăn cột bị OCR đọc ra:
  // "O", "QO", "oO", "@®", "(®", "©)", "|", "=]", "[J]", "[-]", "Í-]", "☑"...
  // Chỉ gồm ký hiệu và chữ IN HOA dễ nhầm (cộng "o"), để không nuốt mất chữ thật như "lọc", "có"
  const RADIO_TOKEN_RE = /^[OoQ0ØÔỞÒƠỌCJIÍV©®@○●◯◉•()[\]|'=\-–_✓✔☐☑☒□■]{1,4}$/u;

  // Hàng nút chọn Đúng/Sai ("@ Sai @ Đúng", "○ Đúng"): bỏ, vì câu hỏi đã ghi "Đúng hay Sai"
  const TRUE_FALSE_RE = /^(?:đúng|sai|true|false)$/iu;
  function isChoiceRow(line) {
    const tokens = line.trim().split(/\s+/);
    const tf = tokens.filter((t) => TRUE_FALSE_RE.test(t)).length;
    const radios = tokens.filter((t) => RADIO_TOKEN_RE.test(t)).length;
    return tf > 0 && tf + radios === tokens.length && (radios > 0 || tf >= 2);
  }

  // Dòng hướng dẫn của trang làm bài: "ⓘ Sinh viên chọn 2 phương án đúng nhất"
  const HINT_RE =
    /^\W{0,3}\s*(?:sinh\s*viên|thí\s*sinh|học\s*sinh|bạn|em)?\s*(?:hãy\s*)?chọn\s+(?:\d+|một|hai|ba|bốn|nhiều)\s+(?:phương\s*án|đáp\s*án|câu\s*trả\s*lời)(?:\s+đúng(?:\s+nhất)?)?\s*[.:]?\s*$/iu;

  // Chữ cái đáp án đứng riêng: "A", "B.", "C)", "(D)", "A,", và "Cc" (OCR đọc lặp chữ)
  function optionLetter(token) {
    const m = /^\(?([A-H])([A-Ha-h])?\)?([.):,])?$/u.exec(token || '');
    if (!m || (m[2] && m[2].toUpperCase() !== m[1])) return null;
    return { letter: m[1], punct: Boolean(m[3]) };
  }

  const nextLetter = (l) => String.fromCharCode(l.charCodeAt(0) + 1);

  // Tách dòng đáp án, kể cả nhiều đáp án nằm trên một dòng (bố cục 2 cột):
  //   "A @® Kỹ năng lập trình Python B | O Kỹ năng làm việc nhóm"
  //   -> ["A. Kỹ năng lập trình Python", "B. Kỹ năng làm việc nhóm"]
  // Chữ cái giữa dòng chỉ được coi là đáp án mới khi đúng thứ tự (A→B→C) và có dấu chấm hoặc
  // nút chọn đi kèm, để không tách nhầm câu như "vitamin B và C". Không phải dòng đáp án thì trả null.
  function splitOptionRow(line, prevLetter) {
    const tokens = line.replace(/(^|\s)([A-H][.):])(?=\S)/gu, '$1$2 ').trim().split(/\s+/);
    // Chữ cái đáp án bị đọc thành chữ thường ("c Dễ định lượng..."): chỉ nhận khi đúng thứ tự sau đáp án trên
    if (/^[a-h]$/.test(tokens[0]) && prevLetter && tokens[0].toUpperCase() === nextLetter(prevLetter)) {
      tokens[0] = tokens[0].toUpperCase();
    }
    const first = optionLetter(tokens[0]);
    if (!first) return null;

    const options = [];
    let current = null;
    let expected = first.letter;
    for (let i = 0; i < tokens.length; i++) {
      const head = optionLetter(tokens[i]);
      const marked = head && (head.punct || RADIO_TOKEN_RE.test(tokens[i + 1] || ''));
      if (head && head.letter === expected && (i === 0 || marked)) {
        current = { letter: head.letter, marked, words: [] };
        options.push(current);
        expected = nextLetter(head.letter);
        while (i + 1 < tokens.length && RADIO_TOKEN_RE.test(tokens[i + 1])) i++; // bỏ nút chọn
        continue;
      }
      if (tokens[i] !== '|') current.words.push(tokens[i]);
    }

    // Chữ cái đầu dòng đứng trơ trọi ("A Kỹ năng...") chỉ được coi là đáp án khi có nút chọn,
    // có dấu chấm, có đáp án tiếp theo trên cùng dòng, hoặc nối tiếp đáp án dòng trên
    const ok = first.punct || options[0].marked || options.length > 1 || (prevLetter && first.letter === nextLetter(prevLetter));
    if (!ok || options.every((o) => !o.words.length)) return null;
    return options.filter((o) => o.words.length).map((o) => `${o.letter}. ${o.words.join(' ')}`);
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
      for (const piece of splitOptionRow(line, prevLetter) || [line]) {
        if (isUiLine(piece) || isNoise(piece) || isChoiceRow(piece) || HINT_RE.test(piece)) continue;
        const m = /^\s*([A-H])\s*[.):,]/.exec(piece);
        // Chỉ quên chữ cái đáp án trước đó khi sang câu hỏi mới
        if (m) prevLetter = m[1];
        else if (KEYWORD_RE.test(piece)) prevLetter = null;
        out.push(piece);
      }
    }
    return out;
  }

  // Trả về { intro, continuation, questions: [{ raw, body }] }
  // intro: phần chữ trước câu hỏi đầu tiên (tiêu đề đề thi...), giữ nguyên.
  // continuation: ảnh bắt đầu bằng đáp án => phần đáp án tràn từ câu cuối của ảnh trước.
  function splitQuestions(text) {
    const lines = cleanLines(String(text || '').replace(/\r\n?/g, '\n').split('\n'));
    // Ảnh không có "Câu N" mà là câu Đúng/Sai nhiều ý: "1)", "2)" là ý con, không phải số câu
    const firstNumbered = lines.findIndex((l) => NUMBER_RE.test(l));
    const trueFalseItems = firstNumbered > 0 && TRUE_FALSE_STEM_RE.test(lines.slice(0, firstNumbered).join(' '));
    const marker = lines.some((l) => KEYWORD_RE.test(l))
      ? KEYWORD_RE
      : firstNumbered >= 0 && !trueFalseItems
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
        // (trừ câu kéo thả / Đúng-Sai nhiều ý: các đoạn bên dưới thuộc cùng câu)
        starts = prevBlank && !(current && current.grouped);
      }

      if (starts) {
        let body = marker ? line.replace(marker, '') : line.replace(JUNK_LABEL_RE, '');
        // Ký tự rác lẻ loi sau nhãn số câu ("Câu 1: y")
        if (marker && /^\s*[^\s?]{1,2}\s*$/u.test(body)) body = '';
        const grouped = MATCHING_RE.test(line) || TRUE_FALSE_STEM_RE.test(line);
        current = { raw: [line], body: [body], hasOption: false, grouped };
        questions.push(current);
      } else if (current) {
        // Giữ dòng trống bên trong câu: ranh giới giữa các cặp của câu kéo thả
        if (prevBlank) {
          current.raw.push('');
          current.body.push('');
        }
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
      questions: questions.map((q) => ({ raw: formatBody(q.raw.join('\n')), body: formatBody(q.body.join('\n')) })),
    };
  }

  // ---------- Định dạng theo loại câu hỏi ----------
  // Câu kéo thả / ghép nối: "Hãy kéo thả mỗi kỹ năng mềm với mô tả phù hợp nhất"
  const MATCHING_RE = /kéo\s*(?:và\s*)?thả|ghép\s*(?:nối|cặp|đôi)|nối\s*(?:mỗi|các|cột|từ)|drag\s*(?:and|&)\s*drop|\bmatch(?:ing)?\b/iu;
  // Câu Đúng/Sai nhiều ý: "Phát biểu sau đây về ... Đúng hay Sai?" + các ý "1) ...", "2) ..."
  const TRUE_FALSE_STEM_RE = /đúng\s*(?:hay|hoặc|\/|-)\s*sai|true\s*(?:or|\/)\s*false/iu;
  const SUB_ITEM_RE = /^\s*\(?\d{1,2}\s*[).]\s+\S/u;

  const letterWords = (line) => line.match(/\p{L}+/gu) || [];
  // Hàng nút "C sai @ Đúng #": chỉ gồm chữ Đúng/Sai và ký tự lẻ
  function isTrueFalseRow(line) {
    const words = letterWords(line);
    return words.some((w) => TRUE_FALSE_RE.test(w)) && words.every((w) => TRUE_FALSE_RE.test(w) || w.length === 1);
  }

  function formatBody(text) {
    const lines = text.split('\n');
    const filled = lines.filter((l) => l.trim());
    const firstSub = filled.findIndex((l) => SUB_ITEM_RE.test(l));
    if (firstSub >= 0 && TRUE_FALSE_STEM_RE.test(filled.slice(0, firstSub).join(' '))) {
      return formatTrueFalse(filled, firstSub);
    }
    if (MATCHING_RE.test(filled.slice(0, 2).join(' '))) return formatMatching(lines);
    return filled.join('\n').trim();
  }

  // Mỗi ý nhỏ, bên dưới in "Đúng" và "Sai". Bỏ các hàng nút đọc được từ ảnh (thường sai/thiếu).
  function formatTrueFalse(lines, firstSub) {
    const out = lines.slice(0, firstSub);
    let item = null;
    const flush = () => item && out.push(item, 'Đúng', 'Sai');
    for (const line of lines.slice(firstSub)) {
      if (SUB_ITEM_RE.test(line)) {
        flush();
        item = line.trim();
      } else if (!isTrueFalseRow(line) && letterWords(line).filter((w) => w.length >= 2).length >= 2) {
        item += ' ' + line.trim(); // phần xuống hàng của ý
      }
    }
    flush();
    return out.join('\n').trim();
  }

  // Các cặp cách nhau bằng dòng trống; trong mỗi cặp dòng đầu là từ khoá, phần còn lại là mô tả:
  //   Tư duy phản biện và giải quyết vấn đề
  //   - Giúp bạn phân tích thông tin khách quan...
  function formatMatching(lines) {
    const groups = [];
    let group = [];
    for (const line of lines) {
      if (line.trim()) group.push(line.trim());
      else if (group.length) {
        groups.push(group);
        group = [];
      }
    }
    if (group.length) groups.push(group);
    const [stem = [], ...pairs] = groups;
    const out = [...stem];
    for (const [keyword, ...desc] of pairs) {
      out.push(trimTail(keyword));
      if (desc.length) out.push(`- ${trimTail(desc.join(' '))}`);
    }
    return out.join('\n').trim();
  }

  // Rác cuối dòng do icon "X" đè lên chữ: số lẻ ("sáng tạo 3") hoặc chữ in hoa có dấu ("hợp tác SỰ").
  // Từ viết tắt thật (SQL, USB...) không có dấu nên được giữ.
  function trimTail(line) {
    return line.replace(/\s+(?:\d|(?=\p{Lu}{1,3}$)[\p{Lu}]*[^\x00-\x7F][\p{Lu}]*)$/u, '');
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
