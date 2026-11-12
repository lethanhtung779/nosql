# NexaSalon database scripts

Các file trong thư mục này được tách từ logic đang dùng tại `apps/api/src` để phục vụ
trình bày, kiểm tra và khởi tạo cấu trúc của ba hệ quản trị CSDL.

## 1. MongoDB

Khởi tạo collection, JSON Schema validation và index:

```powershell
Get-Content database-scripts/mongodb/init.mongodb.js -Raw | docker exec -i spa-salon-mongodb mongosh --quiet
```

Script không xóa dữ liệu. Nếu collection đã tồn tại, validator và index sẽ được cập nhật.

## 2. Redis

Redis không có schema cố định. Dự án dùng các nhóm key:

- `cache:branches`, `cache:services:*`: cache danh mục, TTL mặc định 300 giây.
- `slot-hold:<token>`: nội dung giữ chỗ, TTL mặc định 900 giây.
- `slot-index:<staffId>:<yyyy-mm-dd>`: Sorted Set tra cứu các slot đang giữ.

Chạy thử Lua giữ chỗ nguyên tử (thay các giá trị mẫu nếu cần):

```powershell
Get-Content database-scripts/redis/acquire-slot-hold.lua -Raw | docker exec -i spa-salon-redis redis-cli --eval /dev/stdin `
  slot-index:STAFF_ID:2026-11-12 slot-hold:TOKEN , `
  1794506399999 1794502800000 `
  '{"token":"TOKEN","userId":"USER_ID","staffId":"STAFF_ID","branchId":"BRANCH_ID","serviceIds":["SERVICE_ID"],"startTime":"2026-11-12T09:00:00.000Z","endTime":"2026-11-12T10:00:00.000Z","startMs":1794502800000,"endMs":1794506400000}' `
  900 TOKEN
```

Các lệnh kiểm tra key nằm trong `redis/operations.redis` và có thể dán trực tiếp vào
RedisInsight CLI sau khi thay placeholder.

## 3. Neo4j

Khởi tạo constraint:

```powershell
Get-Content database-scripts/neo4j/schema.cypher -Raw | docker exec -i spa-salon-neo4j cypher-shell -u neo4j -p nexasalon-graph
```

Phân loại lại khách hàng từ đồ thị hiện có:

```powershell
Get-Content database-scripts/neo4j/customer-segmentation.cypher -Raw | docker exec -i spa-salon-neo4j cypher-shell -u neo4j -p nexasalon-graph
```

`sync-completed-appointment.cypher` là truy vấn tham số hóa được API sử dụng khi một
lịch hẹn hoàn thành. Truy vấn này nên được gọi qua driver với các tham số ghi ở đầu file.

