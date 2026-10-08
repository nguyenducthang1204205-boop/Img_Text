# Đức Thắng

Ứng dụng web: đăng nhập → tải nhiều ảnh → trích xuất toàn bộ chữ trong ảnh (OCR tiếng Việt + tiếng Anh) → đánh số và lọc câu hỏi trùng → tải về file Word (.docx) chỉ gồm các câu hỏi và đáp án.

Chạy trên **Cloudflare Workers + D1**, dùng được với gói Free:

- **OCR và tạo file Word chạy ngay trên trình duyệt** (Tesseract.js, docx). Ảnh không tải lên server.
- **Cloudflare Worker** (`src/index.js`) lo đăng nhập/đăng ký và chặn trang `/app/` khi chưa đăng nhập. Các file trong `public/` được Cloudflare phục vụ trực tiếp. Tài khoản và phiên đăng nhập lưu trong D1.

## Triển khai

Code nằm trên GitHub (`nguyenducthang1204205-boop/Img_Text`). Worker `img-text` trên Cloudflare đã được kết nối với repo này: **mỗi lần đẩy code lên nhánh `main`, Cloudflare tự build và cập nhật trang** (lệnh deploy: `npx wrangler deploy`).

Cơ sở dữ liệu D1 `duc-thang-db` đã được khai báo trong `wrangler.toml`. Khi cần tạo lại bảng trên D1 mới, có hai cách:

- Dán nội dung `migrations/0001_init.sql` vào tab **Console** của database trên Cloudflare Dashboard rồi bấm Execute.
- Hoặc chạy `npx wrangler login` rồi `npm run db:remote`.

Muốn dùng tên miền riêng: Cloudflare Dashboard → Workers & Pages → img-text → Settings → Domains & Routes.

## Chạy thử trên máy

```bash
npm install
npm run db:local      # chỉ cần chạy lần đầu
npm run dev           # mở http://127.0.0.1:8788
```

## Cách dùng

1. Thêm ảnh bằng một trong các cách: kéo thả vào khung, bấm để chọn nhiều ảnh, hoặc **dán ảnh đã copy**: bấm nút **📋 Dán ảnh**, hoặc bấm vào ô dán rồi nhấn Ctrl+V (trên điện thoại: nhấn giữ vào ô → Dán). Ctrl+V ở bất kỳ đâu trên trang cũng dán được.
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
     - nút tròn / ô vuông chọn đáp án ("O A." → "A.", "8." → "B."), hàng nút "Đúng / Sai", dòng hướng dẫn "Sinh viên chọn 2 phương án đúng nhất";
     - đáp án và ý trình bày 2 cột được đọc đúng thứ tự (hết cột trái mới sang cột phải), dòng bị xuống hàng được nối lại.
   - Ô **Xem trước** cho thấy đúng nội dung sẽ nằm trong file Word.
4. Bấm **Tải file Word**: file `.docx` chỉ gồm các câu hỏi, viết liền nhau, mỗi câu cách nhau 1 dòng trống, số câu được in đậm.

## Hạn chế

- Ma trận, công thức hay hình vẽ dạng ảnh trong câu hỏi không đọc được bằng OCR nên bị bỏ. Bạn cần tự bổ sung vào file Word.
- Điện thoại cấu hình yếu sẽ đọc mỗi ảnh chậm hơn máy tính vài giây.
- Ảnh chụp màn hình bằng điện thoại (có sọc vân) được làm phẳng nền trước khi đọc, nhưng vẫn có thể sai vài dấu câu; hãy xem lại phần xem trước.

## Cấu trúc

```
public/               Trang web tĩnh
  login.html, auth.js, style.css    Trang đăng nhập / đăng ký (công khai)
  app/                Chỉ xem được khi đã đăng nhập
    index.html, app.js              Giao diện chính, tạo file Word
    ocr.js                          Gọi Tesseract.js trên trình duyệt (đọc 2 lượt: đo cỡ chữ rồi phóng to nếu cần)
    layout.js                       Dựng lại văn bản theo bố cục nhiều cột, bỏ dòng rác có độ tin cậy thấp
    image-prep.js                   Làm phẳng nền (bỏ sọc vân khi chụp màn hình), phóng to theo cỡ chữ (Lanczos3), tăng tương phản
    fix-text.js                     Tách âm tiết tiếng Việt bị đọc dính ("lọcnhiễu" → "lọc nhiễu")
    questions.js                    Dọn chữ thừa, tách câu hỏi, đánh số, lọc câu trùng
src/index.js          Cloudflare Worker: API đăng nhập (/api/register, login, logout, me),
                      chặn /app/ khi chưa đăng nhập, còn lại trả file tĩnh trong public/
lib/auth.js           Băm mật khẩu PBKDF2, quản lý phiên đăng nhập trong D1
migrations/           Cấu trúc bảng D1
wrangler.toml         Cấu hình Cloudflare
_ban-cu-nodejs/       Bản cũ chạy bằng Node.js/Express (không còn dùng, có thể xoá)
```
