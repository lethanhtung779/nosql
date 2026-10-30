const bcrypt = require('bcryptjs');
const { connectDb, closeDb } = require('../src/db');

async function seed() {
  const db = await connectDb();
  await Promise.all(['users', 'branches', 'services', 'appointments', 'reviews', 'temp_slots', 'staff_calendars'].map((name) => db.collection(name).deleteMany({})));

  const branches = [
    { name: 'Lumière Salon Quận 1', address: '123 Nguyễn Trãi, Bến Thành, Quận 1, TP.HCM', phone: '028 3822 1100', location: { type: 'Point', coordinates: [106.6917, 10.7719] }, opening_hours: { open: '08:30', close: '21:30' }, status: 'ACTIVE' },
    { name: 'Lumière Spa Thủ Đức', address: '88 Võ Văn Ngân, Linh Chiểu, TP. Thủ Đức', phone: '028 3722 2200', location: { type: 'Point', coordinates: [106.7627, 10.8506] }, opening_hours: { open: '09:00', close: '21:00' }, status: 'ACTIVE' }
  ];
  const branchResult = await db.collection('branches').insertMany(branches);
  const [branchOne, branchTwo] = Object.values(branchResult.insertedIds);
  const password_hash = await bcrypt.hash('123456', 12);
  const users = [
    { name: 'Quản trị viên', phone: '0900000001', password_hash, role: 'ADMIN', status: 'ACTIVE', created_at: new Date() },
    { name: 'Trần Tuấn', phone: '0900000002', password_hash, role: 'STAFF', specialty: 'Stylist', branch_id: branchOne, status: 'ACTIVE', created_at: new Date() },
    { name: 'Lê Ngọc Mai', phone: '0900000003', password_hash, role: 'STAFF', specialty: 'Spa therapist', branch_id: branchTwo, status: 'ACTIVE', created_at: new Date() },
    { name: 'Nguyễn Văn An', phone: '0900000004', password_hash, role: 'CUSTOMER', status: 'ACTIVE', created_at: new Date() }
  ];
  await db.collection('users').insertMany(users);

  const allBranches = [branchOne, branchTwo];
  await db.collection('services').insertMany([
    { name: 'Cắt tạo kiểu', category: 'Tóc', description: 'Tư vấn và tạo kiểu phù hợp khuôn mặt.', price: 150000, duration_minutes: 45, branch_ids: allBranches, steps: [{ order: 1, name: 'Tư vấn' }, { order: 2, name: 'Gội và cắt' }, { order: 3, name: 'Tạo kiểu' }], status: 'ACTIVE' },
    { name: 'Gội dưỡng sinh', category: 'Tóc', description: 'Thư giãn da đầu với thảo mộc.', price: 120000, duration_minutes: 30, branch_ids: allBranches, steps: [{ order: 1, name: 'Làm sạch' }, { order: 2, name: 'Massage' }], status: 'ACTIVE' },
    { name: 'Nhuộm phục hồi', category: 'Tóc', description: 'Nhuộm màu kết hợp dưỡng phục hồi.', price: 650000, duration_minutes: 120, branch_ids: [branchOne], steps: [{ order: 1, name: 'Kiểm tra tóc' }, { order: 2, name: 'Pha màu' }, { order: 3, name: 'Nhuộm và hấp dưỡng' }], status: 'ACTIVE' },
    { name: 'Facial cấp ẩm', category: 'Spa', description: 'Làm sạch sâu và cấp ẩm làn da.', price: 390000, duration_minutes: 75, branch_ids: [branchTwo], steps: [{ order: 1, name: 'Soi da' }, { order: 2, name: 'Làm sạch sâu' }, { order: 3, name: 'Đắp mặt nạ' }], status: 'ACTIVE' }
  ]);
  console.log('Đã tạo dữ liệu mẫu. Tài khoản dùng chung mật khẩu 123456:');
  console.log('Admin 0900000001 | Thợ 0900000002, 0900000003 | Khách 0900000004');
}

seed().finally(closeDb).catch((error) => { console.error(error); process.exitCode = 1; });
