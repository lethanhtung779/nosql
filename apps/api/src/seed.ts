import mongoose from 'mongoose';
import Redis from 'ioredis';
import * as bcrypt from 'bcryptjs';

async function run() {
  const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/spa_salon');
  await redis.flushdb();
  const db = mongoose.connection.db!;
  for (const name of ['users', 'branches', 'services', 'appointments', 'reviews', 'staffcalendars', 'tempslots', 'adminaudits']) {
    await db.collection(name).deleteMany({});
  }

  const branchResult = await db.collection('branches').insertMany([
    { name: 'NexaSalon Central', address: '123 Nguyễn Trãi, Quận 1, TP.HCM', phone: '028 3822 1100', location: { type: 'Point', coordinates: [106.6917, 10.7719] }, opening_hours: { open: '08:30', close: '21:30' }, status: 'ACTIVE' },
    { name: 'NexaSalon Riverside', address: '88 Võ Văn Ngân, TP. Thủ Đức', phone: '028 3722 2200', location: { type: 'Point', coordinates: [106.7627, 10.8506] }, opening_hours: { open: '09:00', close: '21:00' }, status: 'ACTIVE' }
  ]);
  const [central, riverside] = Object.values(branchResult.insertedIds);
  const passwordHash = await bcrypt.hash('123456', 12);
  const userResult = await db.collection('users').insertMany([
    { name: 'Quản trị viên', phone: '0900000001', password_hash: passwordHash, role: 'ADMIN', status: 'ACTIVE' },
    { name: 'Trần Tuấn', phone: '0900000002', password_hash: passwordHash, role: 'STAFF', specialty: 'Stylist', branch_id: central, status: 'ACTIVE' },
    { name: 'Lê Ngọc Mai', phone: '0900000003', password_hash: passwordHash, role: 'STAFF', specialty: 'Chuyên viên chăm sóc da', branch_id: riverside, status: 'ACTIVE' },
    { name: 'Nguyễn Văn An', phone: '0900000004', password_hash: passwordHash, role: 'CUSTOMER', status: 'ACTIVE' },
    { name: 'Trần Minh Anh', phone: '0900000005', password_hash: passwordHash, role: 'CUSTOMER', status: 'ACTIVE' }
  ]);
  const [, stylist, , customerOne, customerTwo] = Object.values(userResult.insertedIds);
  const serviceResult = await db.collection('services').insertMany([
    { name: 'Cắt tạo kiểu', category: 'Tóc', description: 'Tư vấn và tạo kiểu phù hợp khuôn mặt.', price: 150000, duration_minutes: 45, branch_ids: [central, riverside], steps: [{ order: 1, name: 'Tư vấn' }, { order: 2, name: 'Gội và cắt' }], status: 'ACTIVE' },
    { name: 'Gội dưỡng sinh', category: 'Tóc', description: 'Thư giãn da đầu với thảo mộc.', price: 120000, duration_minutes: 30, branch_ids: [central, riverside], steps: [{ order: 1, name: 'Làm sạch' }, { order: 2, name: 'Massage' }], status: 'ACTIVE' },
    { name: 'Nhuộm phục hồi', category: 'Tóc', description: 'Nhuộm màu kết hợp dưỡng phục hồi.', price: 650000, duration_minutes: 120, branch_ids: [central], status: 'ACTIVE' },
    { name: 'Facial cấp ẩm', category: 'Spa', description: 'Làm sạch sâu và cấp ẩm làn da.', price: 390000, duration_minutes: 75, branch_ids: [riverside], status: 'ACTIVE' }
  ]);
  const [haircut, wellness] = Object.values(serviceResult.insertedIds);

  const now = new Date();
  const completedStart = new Date(now); completedStart.setDate(now.getDate() - 1); completedStart.setHours(14, 0, 0, 0);
  const completedEnd = new Date(completedStart.getTime() + 45 * 60_000);
  const upcomingStart = new Date(now); upcomingStart.setDate(now.getDate() + 1); upcomingStart.setHours(10, 0, 0, 0);
  const upcomingEnd = new Date(upcomingStart.getTime() + 30 * 60_000);
  const appointmentResult = await db.collection('appointments').insertMany([
    { booking_code: 'BK-DEMO-COMPLETED', branch_id: central, customer: { user_id: customerOne, name: 'Nguyễn Văn An', phone: '0900000004' }, staff: { staff_id: stylist, name: 'Trần Tuấn' }, time_slot: { start_time: completedStart, end_time: completedEnd }, services_booked: [{ service_id: haircut, name: 'Cắt tạo kiểu', price: 150000, duration: 45 }], total_amount: 150000, note: 'Tạo kiểu gọn gàng', status: 'COMPLETED', created_at: completedStart, updated_at: completedEnd },
    { booking_code: 'BK-DEMO-UPCOMING', branch_id: central, customer: { user_id: customerTwo, name: 'Trần Minh Anh', phone: '0900000005' }, staff: { staff_id: stylist, name: 'Trần Tuấn' }, time_slot: { start_time: upcomingStart, end_time: upcomingEnd }, services_booked: [{ service_id: wellness, name: 'Gội dưỡng sinh', price: 120000, duration: 30 }], total_amount: 120000, note: 'Ưu tiên tinh dầu dịu nhẹ', status: 'CONFIRMED', created_at: now, updated_at: now }
  ]);
  await db.collection('staffcalendars').insertOne({ staff_id: stylist, date_key: upcomingStart.toISOString().slice(0, 10), slots: [{ appointment_code: 'BK-DEMO-UPCOMING', start_time: upcomingStart, end_time: upcomingEnd, status: 'CONFIRMED' }] });
  await db.collection('reviews').insertOne({ appointment_id: appointmentResult.insertedIds[0], customer_id: customerOne, staff_id: stylist, rating: 5, comment: 'Dịch vụ chu đáo và đúng giờ.', images: [], created_at: completedEnd, updated_at: completedEnd });

  console.log('Seed NexaSalon hoàn tất: 5 tài khoản, 2 chi nhánh, 4 dịch vụ và dữ liệu báo cáo mẫu.');
  await redis.quit();
  await mongoose.disconnect();
}

run().catch(error => { console.error(error); process.exit(1); });
