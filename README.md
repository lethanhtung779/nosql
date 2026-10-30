# Lumière Spa Salon NoSQL

Đồ án quản lý lịch hẹn Spa/Salon theo kiến trúc monorepo:

- `apps/api`: NestJS, TypeScript, Mongoose, ioredis, Passport JWT và Swagger.
- `apps/web`: Next.js App Router và React.
- MongoDB là CSDL chính, lưu dữ liệu nghiệp vụ lâu dài.
- Redis là CSDL thứ hai, giữ slot TTL 15 phút và cache dữ liệu danh mục.

## Chạy dự án

Yêu cầu Node.js 20+, MongoDB 7 hoặc Docker Desktop.

```powershell
Copy-Item .env.example .env
docker compose up -d
npm install
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
| Khách hàng | `0900000004` |

## Nghiệp vụ

- Đăng ký, đăng nhập JWT và Guards phân quyền.
- Chi nhánh GeoJSON, dịch vụ và chuyên viên.
- MongoDB lưu snapshot dịch vụ, giá, khách và nhân viên trong lịch hẹn.
- Redis dùng khóa TTL 900 giây để giữ chỗ và chặn khách khác chọn slot đang giữ.
- MongoDB cập nhật lịch nhân viên nguyên tử để kiểm tra xung đột lần cuối.
- Redis cache chi nhánh và dịch vụ trong 5 phút.
- Đánh giá lịch đã hoàn thành.
- Aggregation Pipeline báo cáo doanh thu, top dịch vụ và rating.

## Kiểm tra

```powershell
npm test
npm run build
```

## Hai hệ CSDL NoSQL

| CSDL | Vai trò |
|---|---|
| MongoDB | Users, branches, services, appointments, reviews, GeoJSON và Aggregation Pipeline |
| Redis | Slot hold TTL, distributed lock và cache catalog |

Luồng đặt lịch: `POST /api/slots/hold` tạo khóa Redis trong 15 phút, sau đó `POST /api/appointments` dùng `hold_token` để xác nhận và ghi MongoDB.

Phiên bản chính thức nằm trong `apps`. Các thư mục `src`, `public` và `scripts` ở root là bản Express cũ được giữ lại để đối chiếu kiến trúc.
