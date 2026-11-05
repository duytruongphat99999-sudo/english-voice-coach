# English Voice Coach

[Học miễn phí](https://english.duytruongphatco.com/) · [Mã nguồn](https://github.com/duytruongphat99999-sudo/english-voice-coach)

Học tiếng Anh cho người Việt, ưu tiên điện thoại. Miễn phí, không quảng cáo, không cần tài khoản ở khu học chung.

- 48 chủ đề với 240 câu nghe có sẵn, từ nền tảng đến bài luyện học thuật nâng cao.
- Ngành y và điện là nhánh tự chọn; người mới luôn bắt đầu bằng nền tảng A1. Có 6 chủ đề y khoa chung và 9 chủ đề ngành điện, cùng các chủ đề y/da liễu có sẵn.
- Nghe: giấu câu trước khi nghe, hiện bản dịch và tự đánh giá trí nhớ.
- Nói: nghe mẫu, ghi âm tối đa 45 giây, nghe lại để đối chiếu. Bản thu không gửi lên máy chủ; khu miễn phí không tự chấm phát âm.
- Đọc: chọn nghĩa tiếng Việt, có phản hồi và đáp án khi sai.
- Viết: chép chính tả từ âm thanh, kiểm tra và viết lại.
- Hồ sơ riêng theo từng người trên thiết bị; mục tiêu PTE 55–90, thời gian học và mức bắt đầu riêng cho nghe/nói/đọc/viết. Có xuất/nhập hồ sơ và tiến độ.
- Gợi ý theo kỹ năng yếu, ưu tiên nền tảng; tăng độ khó từng kỹ năng dựa trên thực hành. Lịch ôn dựa trên tự nhớ, không quy đổi thành điểm thi.
- PWA có thể cài lên màn hình chính. Tải khoảng 7,2 MB âm thanh một lần để học offline.

## Mục tiêu và lộ trình

PTE Academic là trục chính. PTE 90 overall tương ứng IELTS 9.0 overall theo Pearson; app không cam kết thi đạt và không dùng điểm câu ngắn làm điểm PTE. Bốn kỹ năng có mức luyện độc lập A1–C2; y và điện chỉ thêm ngữ cảnh tự chọn sau nền tảng. Chi tiết cơ chế, lưu trữ, nhập/xuất và giới hạn bộ bài: [Lộ trình học cá nhân](docs/LEARNING-PATH.md).

Trang **Các dạng bài PTE** mở công khai có danh mục 22 dạng; bộ luyện thi chuyên sâu và AI hiện vẫn ở khu cá nhân có mật khẩu.

## Học offline

Mở trang khi có mạng, bấm **Tải để học offline**, chờ **Đã tải đủ** rồi có thể tắt mạng. Nội dung, chữ và font cũng được lưu trên thiết bị. Âm thanh đã nghe được cache tự động; tải toàn bộ giúp học cả những bài chưa mở. Trình duyệt có thể dọn dữ liệu khi thiếu bộ nhớ; xóa dữ liệu trang sẽ xóa cả tiến độ chưa sao lưu. Thu âm cần HTTPS hoặc localhost và quyền mic. Safari/iPhone: Chia sẻ → Thêm vào Màn hình chính.

## Chạy bản miễn phí

Cần Node.js 24+:

```sh
cd web
npm ci
npm run build
npm run preview -- --host 127.0.0.1 --port 4423
```

Mở http://127.0.0.1:4423. Không cần API key. Hoặc chạy Docker chỉ phục vụ khu công khai:

```sh
docker compose -f docker-compose.public.yml up -d --build
```

Mở http://127.0.0.1:4324. Muốn dùng trên điện thoại, đặt sau reverse proxy HTTPS. Bản Docker miễn phí không mở API hoặc các trang cá nhân.

## Khu huấn luyện cá nhân (tùy chọn)

`/coach` giữ các tính năng cũ: lộ trình 4 chặng, FSRS-6, PTE, shadowing, tiếng Pháp, Gemini roleplay và chấm giọng nói bằng Whisper. Dữ liệu SQLite của khu này thuộc **một người dùng**, chưa phải hệ thống đa tài khoản. Không chia sẻ mật khẩu quản trị cho khách công khai. Điểm nhận dạng lời nói không phải đánh giá âm vị hay điểm thi chính thức.

```sh
cp .env.example .env
# Điền Gemini key và token; sinh mật khẩu và secret:
bash scripts/set-password.sh
docker compose up -d --build
bash scripts/preload-models.sh
```

Web: localhost:4323; API: localhost:3040; speaches: localhost:8010. Các cổng chỉ bind loopback. nginx mở `/`, file bài nghe, font, manifest và tài nguyên build; mọi API cá nhân và các trang khác vẫn yêu cầu cookie hợp lệ. Service worker không cache API, trang đăng nhập hoặc lịch sử riêng.

Cloudflare tunnel tùy chọn dùng `docker-compose.cloudflared.yml`. Public hostname phải trỏ tới `http://localhost:4323`. Đặt token trong `.env`; không commit credential. `scripts/tunnel-up.sh` kiểm tra API riêng vẫn bị chặn trước khi mở tunnel. `/api/today` là giao diện dùng nội bộ cho n8n; không mở công khai.

## Kiểm thử

```sh
cd web
npm run build
npm run check
npx playwright install chromium webkit
npm test
npm audit --omit=dev
# Windows local mặc định dùng Chrome đã cài; CI dùng Chromium.
```

```sh
cd api
npm ci
npm run build
npm test
npm audit --omit=dev
```

GitHub Actions kiểm tra Chromium và WebKit, build, kiểu dữ liệu, 4 kích thước màn hình, nghe/nói/đọc/viết, ghi tiến độ, cache offline, audio range và ranh giới dữ liệu cá nhân. Giả lập trình duyệt không thay thế kiểm tra iPhone/Android thật, bàn phím, quyền mic và cài PWA.

## Nội dung và âm thanh

Nội dung gốc ở `api/content/`. Bộ miễn phí được tạo bởi `node scripts/build-study-content.mjs`; file xuất là `web/src/data/study.json`. Khi thêm câu mới, cập nhật nội dung rồi chạy `node scripts/pregen-study-audio.mjs` trên máy đang có speaches tại localhost:8010. Audio tổng hợp bằng Kokoro, giọng af_heart, tốc độ 0.95. File MP3 có sẵn trong repo nên người self-host không cần model để dùng bản miễn phí.

`web/scripts/build-offline.mjs` tạo cache manifest theo hash của bản build, chỉ lấy phụ thuộc khu công khai. Bài nghe dùng cache riêng, không bị xóa khi cập nhật giao diện. `scripts/backup-db.sh` dùng SQLite VACUUM INTO để sao lưu nhất quán cả dữ liệu WAL; không chép riêng file DB trong lúc chạy.

## Triển khai

```sh
docker compose build evc-web evc-api
docker compose up -d --no-deps evc-api evc-web
```

Không cần khởi động lại dịch vụ model hoặc tunnel khi cập nhật web/API. Trước khi triển khai nên sao lưu DB. Giữ image cũ để rollback khi kiểm tra HTTP hoặc đăng nhập không đạt. CI hiện kiểm tra mã nguồn; triển khai production từ máy tự host, không cấp credential production cho workflow công khai.

## Giấy phép và tham khảo

MIT cho code dự án; font Be Vietnam Pro dùng SIL OFL, giấy phép đi kèm `web/public/fonts/OFL.txt`. Dependencies và model giữ giấy phép riêng. [Các dự án và tài liệu đã tham khảo](docs/RESEARCH.md). Không sao chép source code từ các app tham khảo. Nội dung ngành y và điện để học ngoại ngữ; công việc thực tế cần đào tạo chuyên môn và quy trình an toàn được phê duyệt.
