# Đức Thắng

Ứng dụng web: đăng nhập → tải nhiều ảnh → trích xuất toàn bộ chữ trong ảnh (OCR tiếng Việt + tiếng Anh) → đánh số và lọc câu hỏi trùng → tải về file Word (.docx) chỉ gồm các câu hỏi và đáp án.

Chạy trên **Cloudflare Pages + D1**, dùng được với gói Free:

- **OCR và tạo file Word chạy ngay trên trình duyệt** (Tesseract.js, docx). Ảnh không tải lên server.
- **Cloudflare** chỉ phục vụ trang web và lo đăng nhập/đăng ký (Pages Functions). Tài khoản và phiên đăng nhập lưu trong D1.

## Đưa lên Cloudflare (lần đầu)

Cần có tài khoản Cloudflare (miễn phí) và Node.js.

```bash
npm install
npx wrangler login                                  # mở trình duyệt để đăng nhập Cloudflare
npx wrangler d1 create duc-thang-db                 # tạo cơ sở dữ liệu
```

Lệnh `d1 create` in ra một `database_id`. Chép giá trị đó vào `wrangler.toml`, thay cho `00000000-0000-0000-0000-000000000000`. Sau đó chạy:

```bash
npm run db:remote                                   # tạo bảng users, sessions trên D1
npx wrangler pages project create duc-thang --production-branch main
npm run deploy                                      # đưa trang web lên Cloudflare
```

Trang web sẽ có địa chỉ `https://duc-thang.pages.dev`. Nếu tên này đã có người dùng, Cloudflare sẽ báo, khi đó bạn đổi `name` trong `wrangler.toml`. Muốn dùng tên miền riêng thì vào Cloudflare Dashboard → Workers & Pages → duc-thang → Custom domains.

**Cập nhật sau khi sửa code:** chỉ cần `npm run deploy`.

## Chạy thử trên máy

```bash
npm install
npm run db:local      # chỉ cần chạy lần đầu
npm run dev           # mở http://localhost:8788
```

## Cách dùng

1. Kéo thả ảnh vào khung, bấm để chọn nhiều ảnh, hoặc dán ảnh bằng Ctrl+V.
2. Bấm **Trích xuất chữ**. Lần đầu, trình duyệt tải dữ liệu nhận dạng chữ (khoảng 10–15MB), các lần sau dùng bản đã lưu. Chữ hiện ra trong ô bên cạnh mỗi ảnh và bạn có thể sửa lại.
3. Trong bảng **Xử lý câu hỏi**:
   - **Đánh số câu hỏi tự động**: nhận câu hỏi theo dạng "Câu 1", "Câu hỏi 1", "Bài 1", "Question 1" hoặc "1." ở đầu dòng, rồi đánh số lại liên tục qua tất cả các ảnh (chọn kiểu `Câu 1:`, `Câu 1.`, `1.` hoặc `Question 1:`).
     - Ảnh không có số câu (hoặc nhãn số câu bị đọc sai): mỗi câu hỏi kèm các đáp án A/B/C/D bên dưới được tính là một câu.
     - Ảnh không có cả số câu lẫn đáp án: mỗi đoạn văn là một câu.
     - Đáp án bị tràn sang ảnh sau được nối vào câu cuối của ảnh trước.
   - **Lọc câu hỏi trùng**: bỏ các câu có nội dung giống một câu đã xuất hiện trước đó, kể cả khi số câu khác nhau. Thanh "Độ giống từ" chỉnh mức giống nhau cần thiết: 100% là giống hệt, mặc định 90% để vẫn bắt được câu trùng bị đọc sai vài ký tự. Danh sách câu bị loại hiện bên dưới để kiểm tra.
   - **Chỉ giữ câu hỏi và đáp án**: tự bỏ các thông tin thừa trong ảnh chụp màn hình app/web làm bài:
     - thanh trạng thái điện thoại (giờ, pin) và tiêu đề kèm đồng hồ đếm giờ;
     - số trang ("1/15") và các nhãn/nút như "Trả lời:", "Câu hỏi", "Nộp bài";
     - ký tự rác do đọc ma trận, hình vẽ hoặc nhãn màu;
     - nút tròn chọn đáp án ("O A." → "A.", "8." → "B.").
   - Ô **Xem trước** cho thấy đúng nội dung sẽ nằm trong file Word.
4. Bấm **Tải file Word**: file `.docx` chỉ gồm các câu hỏi, viết liền nhau, mỗi câu cách nhau 1 dòng trống, số câu được in đậm.

## Hạn chế

- Ma trận, công thức hay hình vẽ dạng ảnh trong câu hỏi không đọc được bằng OCR nên bị bỏ. Bạn cần tự bổ sung vào file Word.
- Điện thoại cấu hình yếu sẽ đọc mỗi ảnh chậm hơn máy tính vài giây.

## Cấu trúc

```
public/               Trang web tĩnh
  login.html, auth.js, style.css    Trang đăng nhập / đăng ký (công khai)
  app/                Chỉ xem được khi đã đăng nhập
    index.html, app.js              Giao diện chính, tạo file Word
    ocr.js                          Gọi Tesseract.js trên trình duyệt
    image-prep.js                   Phóng to (Lanczos3), chuyển xám, tăng tương phản ảnh trước khi OCR
    fix-text.js                     Tách âm tiết tiếng Việt bị đọc dính ("lọcnhiễu" → "lọc nhiễu")
    questions.js                    Dọn chữ thừa, tách câu hỏi, đánh số, lọc câu trùng
functions/            Pages Functions (chạy trên Cloudflare)
  _middleware.js                    Chặn /app/ khi chưa đăng nhập
  api/register.js, login.js, logout.js, me.js
lib/auth.js           Băm mật khẩu PBKDF2, quản lý phiên đăng nhập trong D1
migrations/           Cấu trúc bảng D1
wrangler.toml         Cấu hình Cloudflare
_ban-cu-nodejs/       Bản cũ chạy bằng Node.js/Express (không còn dùng, có thể xoá)
```
