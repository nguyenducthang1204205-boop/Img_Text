# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

"Đức Thắng": a web app where a logged-in user adds many screenshots or photos of quiz questions, OCRs them (Vietnamese + English), and downloads a .docx that contains **only the questions and answers**. Questions are numbered continuously across images and duplicates are removed. Each question is separated by exactly one blank line, and the question number is bold. The UI, code comments, README and commit messages are in Vietnamese, so keep them in Vietnamese.

## Commands

```bash
npm install
npm run db:local     # apply migrations/ to the local D1 (first run only)
npm run dev          # wrangler dev on port 8788; open http://127.0.0.1:8788 (use 127.0.0.1, not localhost)
npm run db:remote    # apply migrations to the production D1 (needs `npx wrangler login`)
```

- **Deploy:** push to `main`. The Cloudflare Worker `img-text` is connected to the GitHub repo through Workers Builds, which runs `npx wrangler deploy`. There is no build step, bundler, linter or test suite.
- **Quick tests:** the text-processing modules can be required directly from Node, because each is a UMD file that exports `module.exports` in Node and a `window.X` global in the browser:

```bash
node -e "const Q=require('./public/app/questions.js'); console.log(Q.processItems([{name:'a',index:0,text:'Câu 5: ...\nA. x\nB. y'}]).questions)"
```

- **Full OCR tests:** the whole pipeline (Tesseract + canvas) only runs in a browser. To check OCR changes end to end, drive the `/app/` page with a headless Chrome (e.g. puppeteer-core) against `npm run dev`, logged in with a throwaway account. Use the prefix `zz_test`, then delete only those accounts: `DELETE FROM users WHERE username LIKE 'zz_test%'`.

## Architecture

**The server does only authentication.** `src/index.js` is a Worker with static assets (`wrangler.toml`: `[assets] directory="public"`, `run_worker_first` for `/`, `/app`, `/app/*`, `/api/*`). It serves:

- `/api/register|login|logout|me`
- the `/` redirect
- the login gate on `/app/*` (served with `Cache-Control: private, no-store`).

`lib/auth.js` covers:

- passwords: PBKDF2-SHA256 with 100k iterations
- sessions in D1: only the SHA-256 of the token is stored
- the `session` cookie: HttpOnly, 8 hours.

D1 schema: `migrations/0001_init.sql` (`users`, `sessions`).

**All OCR and .docx generation runs in the browser.** Images are never uploaded; the README promises this to users. Tesseract.js 5.1.1 and docx 9.9.0 are loaded from jsdelivr with pinned versions, and there are no runtime npm dependencies. The scripts in `public/app/index.html` communicate through globals, so their load order matters: fix-text → image-prep → layout → ocr → questions → shuffle → sessions → app.

Pipeline for each image (`ocr.js` → `OCR.recognize`):

1. `ImagePrep.flatten`: convert to gray, divide by a sliding-max/blur background estimate. This removes moiré stripes from photos of laptop screens and uneven backgrounds.
   Then `ImagePrep.eraseMarks` whitens radio buttons and checkboxes. These are hollow, near-square connected components, at least 2× the median glyph height, with fill ratio ≤ 0.35, that come first on their row. Without this step, Tesseract garbles short options such as "○ A. 9".
2. Pass 1 at 1×. `ImagePrep.chooseScale` measures line heights and targets about 48px, up to 3× and at most 16 megapixels. Pass 2 is rendered with JS Lanczos3 only if the scale is ≥ 1.3. Browser canvas upscaling gave worse OCR, so keep the custom resize.
3. `Layout.toText(data.blocks)` rebuilds the text from word boxes:
   - drops lines with confidence < 45 and junk words, but keeps coordinate tokens such as `I'(2,2)`, which Tesseract scores very low even when it reads them correctly
   - cuts segments at large gaps
   - detects columns (each column at least 20% of the width; this keeps the gap after a radio button from being treated as a column break)
   - groups segments into bands and reads the left column, then the right
   - joins wrapped lines.
4. `FixText.fixMergedSyllables` fixes common Vietnamese OCR errors: syllables glued together, `ä`→`ă`, `qu yết`→`quyết`, a `|` between two lowercase words → `I`, and `!(1,2)` → `I'(1,2)`.

The text per image appears in an editable textarea. Then `app.js` calls `Questions.processItems(items, opts)` over all images. `questions.js` runs these stages:

- **`cleanLines`:** strips UI noise (status bar, clocks, pagers, button labels, radio/checkbox glyphs, "Đúng/Sai" button rows, hint lines) and normalizes options to `X. text`. The option work happens in `splitOptionRow`.
- **`splitQuestions`:** works in one of three modes:
  - explicit labels (`Câu 1`, `1.`, …)
  - option-driven: each stem plus its A/B/C/D options is one question
  - paragraph-based.

  Text before the first question in an image can be a continuation of the previous image's last question.
- **`formatBody`:** applies special output for two question types:
  - true/false questions with sub-items: `Đúng` / `Sai` under each item
  - drag-drop/matching questions: the keyword, then `- answer` on the next line.
- **`processItems`:**
  - renumbers questions with the chosen format (`Câu {n}:` …)
  - removes duplicates by Dice similarity on bigrams (threshold slider, default 0.9). Two questions whose sequences of numbers differ are never duplicates, because computation questions from the same template differ only in their numbers.
  - appends overflow text to the previous image's question
  - returns `questions` (null when both numbering and dedupe are off).

`app.js` joins `questions` with `\n\n` (`finalText`). The preview "paper" and `paragraphsOf` (the .docx writer) render that same text with the same `NUM_RE`, so the number prefix is bold in both. The defaults match the old output: Times New Roman 13pt, no title.

Other browser-only features in `app.js`:

- **Trộn đề:** `shuffle.js` (UMD, testable in Node) reorders the questions. It reorders the options only when the last lines of a question are `A.`, `B.`, … in sequence. The .docx has one section per version, plus an optional mapping table.
- **Lịch sử:** `sessions.js` keeps up to 30 sessions per user in `localStorage` (`dt-history:<username>`). It stores text only, never images. Restored items have `file: null`, so rotate and re-OCR are disabled for them. Don't name a global `History`, because that shadows the browser's built-in.
- Also in `app.js`:
  - reordering (drag the grip, or use the up/down buttons)
  - rotate 90° and then re-OCR
  - find & replace across all images, with undo
  - the image viewer
  - light/dark theme (`dt-theme` in `localStorage`, applied by an inline script in `<head>`)
  - keyboard shortcuts.

UI conventions:

- font: Be Vietnam Pro (Google Fonts)
- icons: an inline SVG sprite at the top of each page (no emoji icons)
- colors: tokens on `:root` in `public/style.css`, redefined for dark mode.

## Working on the heuristics

The regexes and thresholds in `questions.js` and `layout.js` were tuned on real screenshots: two-column layouts, radio buttons and checkboxes, moiré photos, true/false questions and drag-drop questions. They break easily in both directions. For example, a too-broad `RADIO_TOKEN_RE` once ate real words such as "lọc" and "có". Raising the upscale factor made the total error count worse. When you change a rule:

- test it against several kinds of images, not only the one that failed
- check that ordinary Vietnamese words are still kept.

## Constraints

- `_ban-cu-nodejs/` is the old Node/Express version. It is gitignored and contains real user data (`data/users.json`). Never commit it, overwrite it or reset it.
- The Cloudflare project is a **Worker** (not Pages). Keep the `main` + `[assets]` configuration and don't add a `functions/` directory.
