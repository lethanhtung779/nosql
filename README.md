# NexaSalon – Spa & Salon Management Platform

Đồ án quản lý lịch hẹn Spa/Salon theo kiến trúc monorepo:

- `apps/api`: NestJS, TypeScript, Mongoose, ioredis, Passport JWT và Swagger.
- `apps/web`: Next.js App Router và React.
- MongoDB là CSDL chính, lưu dữ liệu nghiệp vụ lâu dài.
- Redis là CSDL thứ hai, giữ slot TTL 15 phút và cache dữ liệu danh mục.

## Chạy dự án

Yêu cầu Docker Desktop. Lệnh sau build và chạy toàn bộ website, API, MongoDB và Redis:

```powershell
Copy-Item .env.example .env
docker compose up -d --build
npm run seed
```

Chạy ở chế độ phát triển:

```powershell
npm install
docker compose up -d mongodb redis
npm run seed
npm run dev
```

- Website: http://localhost:3000
- API: http://localhost:3001/api
- Swagger: http://localhost:3001/api/docs

## Tài khoản mẫu

Tất cả dùng mật khẩu `123456`.

| Vai trò | Số điện thoại |
|---|---|
| Admin | `0900000001` |
| Nhân viên | `0900000002` |
| Khách hàng 1 | `0900000004` |
| Khách hàng 2 | `0900000005` |

## Nghiệp vụ

- Đăng ký, đăng nhập JWT và Guards phân quyền.
- Giao diện riêng cho khách hàng, nhân viên và quản trị viên.
- Chi nhánh GeoJSON, dịch vụ và chuyên viên.
- MongoDB lưu snapshot dịch vụ, giá, khách và nhân viên trong lịch hẹn.
- Redis dùng khóa TTL 900 giây để giữ chỗ và chặn khách khác chọn slot đang giữ.
- Hiển thị thời gian giữ chỗ còn lại; cho phép kiểm tra và hủy token giữ chỗ.
- MongoDB cập nhật lịch nhân viên nguyên tử để kiểm tra xung đột lần cuối.
- Redis cache chi nhánh và dịch vụ trong 5 phút.
- Khách hàng xem/hủy lịch và đánh giá lịch đã hoàn thành.
- Nhân viên cập nhật trạng thái theo đúng luồng nghiệp vụ.
- Quản trị viên quản lý chi nhánh, dịch vụ, nhân viên và khóa/mở tài khoản.
- Aggregation Pipeline báo cáo doanh thu, trạng thái lịch, top dịch vụ và hiệu suất nhân viên.

## API chính

| Nhóm | Endpoint tiêu biểu |
|---|---|
| Xác thực | `POST /api/auth/register`, `POST /api/auth/login` |
| Danh mục | `GET /api/branches`, `GET /api/services`, `GET /api/staff` |
| Giữ chỗ Redis | `POST /api/slots/hold`, `GET /api/slots/:token`, `DELETE /api/slots/:token` |
| Lịch hẹn | `POST /api/appointments`, `GET /api/appointments/mine`, `PATCH /api/appointments/:id/status`, `PATCH /api/appointments/:id/cancel` |
| Đánh giá | `POST /api/reviews` |
| Báo cáo | `GET /api/reports/dashboard` |
| Quản trị | `/api/admin/users`, `/api/admin/branches`, `/api/admin/services`, `/api/admin/staff` |

## Kiểm tra

```powershell
npm test
npm run build
npm run test:integration
npm run db:explain
```

`test:integration` kiểm tra đồng thời hai khách giữ cùng khung giờ, phân quyền, snapshot, quy trình phục vụ, đánh giá, cache và báo cáo. Script tự dọn dữ liệu kiểm thử sau khi hoàn tất.

## Hai hệ CSDL NoSQL

| CSDL | Vai trò |
|---|---|
| MongoDB | Users, branches, services, appointments, reviews, GeoJSON và Aggregation Pipeline |
| Redis | Slot hold TTL, distributed lock và cache catalog |

Luồng đặt lịch: `POST /api/slots/hold` tạo khóa Redis trong 15 phút, sau đó `POST /api/appointments` dùng `hold_token` để xác nhận và ghi MongoDB.

Kế hoạch triển khai chi tiết: `Ke_Hoach_Trien_Khai_He_Thong_Spa_Salon_NoSQL.docx`.

Phiên bản chính thức nằm trong `apps`. Các thư mục `src`, `public` và `scripts` ở root là bản Express cũ được giữ lại để đối chiếu kiến trúc.
