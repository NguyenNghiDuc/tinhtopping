# tinhtopping

## Cấu hình Supabase

Ứng dụng lưu nhân viên và ca bán trên Supabase. Không dùng `localStorage` làm database nghiệp vụ.

1. Tạo một project Supabase.
2. Trong SQL Editor, chạy toàn bộ [`supabase/schema.sql`](supabase/schema.sql). Script tạo `employees`, `shifts`, `topping_types`, `shift_toppings`, role profiles, RLS và hàm `save_shift`; nếu bảng `sales_records` cũ có mặt, script sẽ chuyển dữ liệu sang schema mới.
3. Trong Authentication, tạo tài khoản quản lý đầu tiên bằng email và mật khẩu. Trigger sẽ tự tạo hồ sơ với vai trò `staff`.
4. Nâng tài khoản đầu tiên lên `manager` trong SQL Editor, thay email mẫu:

	 ```sql
	 update public.user_profiles
	 set role = 'manager'
	 where user_id = (
		 select id from auth.users where email = lower('manager@example.com')
	 );
	 ```

5. Tắt đăng ký công khai trong Authentication. Tạo tài khoản cho nhân viên trong Authentication; tài khoản mới mặc định là `staff`.
6. Lấy và điền thông tin vào [`js/config.js`](js/config.js):

	- **Project URL:** Supabase Dashboard → chọn project → **Connect** hoặc **Project Settings → API → Project URL**. URL có dạng `https://<project-ref>.supabase.co`; điền vào `SUPABASE_URL`.
	- **Publishable key:** **Project Settings → API Keys → Publishable key** (bắt đầu bằng `sb_publishable_...`); điền vào `SUPABASE_PUBLISHABLE_KEY`. Nếu project cũ chưa có publishable key, dùng **Project Settings → API Keys → Legacy API Keys → anon/public** và điền vào `SUPABASE_ANON_KEY`.

	Không dùng `service_role` hoặc `sb_secret_...` key trong frontend. `js/config.js` có kiểm tra và từ chối các key kiểu này.
7. Deploy project lên Vercel. `vercel.json` cấu hình static output, không cần build hay Node.js khi người dùng mở trang. Root URL `/` phục vụ `index.html` trực tiếp.
8. Mở website, đăng nhập rồi thêm nhân viên trong mục “Nhân viên”. Người nhận link không cần GitHub; tài khoản đăng nhập ứng dụng vẫn cần được tạo trong Supabase.

Chỉ đưa Project URL và publishable/anon key vào frontend. Không đưa `service_role` key vào mã trình duyệt. Các bảng bật Row Level Security: chỉ manager mới thêm/sửa/ẩn nhân viên; nhân viên đăng nhập mới đọc dữ liệu và chỉ sửa/xóa ca do mình tạo.

Khi manager đăng nhập lần đầu, ứng dụng tự chuyển các ca còn trong `localStorage` phiên bản cũ lên Supabase, tạo các hồ sơ nhân viên còn thiếu và bỏ qua ngày/ca đã có trên server. Bản cũ trên trình duyệt không bị xóa.

Website dùng stylesheet tại `public/css/style.css`; trên điện thoại, bảng ca tự chuyển thành các thẻ để không tràn ngang.

## Cấu trúc

- `index.html`: cấu trúc trang và liên kết CSS/JavaScript.
- `public/css/style.css`: giao diện responsive.
- `js/app.js`: đăng nhập, giao diện và luồng nghiệp vụ.
- `js/calculator.js`: tính tổng topping và doanh thu.
- `js/database.js`: truy vấn Supabase.
- `js/supabase.js`, `js/config.js`: client và cấu hình kết nối.
- `supabase/schema.sql`: bảng, trigger, ràng buộc và chính sách RLS.

Danh sách nhân viên được truy vấn từ bảng `employees`; nhân viên nghỉ được ẩn mềm để không làm mất lịch sử ca. Báo cáo tháng được tính từ các ca trong `shifts` và chi tiết trong `shift_toppings`.