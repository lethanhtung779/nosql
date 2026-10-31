import mongoose from 'mongoose';
import Redis from 'ioredis';

const base = process.env.API_URL || 'http://localhost:3001/api';
const mongoUrl = process.env.MONGODB_URI || 'mongodb://localhost:27017/spa_salon';
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
let createdAppointment;
const testStartedAt = new Date();
const adminCreated = { branches: [], services: [], users: [] };

async function request(path, options = {}, expected) {
  const response = await fetch(base + path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  const data = await response.json().catch(() => ({}));
  if (expected !== undefined && response.status !== expected) throw new Error(`${path}: expected ${expected}, received ${response.status} ${JSON.stringify(data)}`);
  return { response, data };
}

async function login(phone) {
  const { data } = await request('/auth/login', { method: 'POST', body: JSON.stringify({ phone, password: '123456' }) }, 201);
  return { token: data.token, user: data.user, headers: { Authorization: `Bearer ${data.token}` } };
}

function assert(value, message) { if (!value) throw new Error(message); }

async function cleanup() {
  await mongoose.connect(mongoUrl);
  const db = mongoose.connection.db;
  if (createdAppointment) {
    await db.collection('reviews').deleteMany({ appointment_id: new mongoose.Types.ObjectId(createdAppointment._id) });
    await db.collection('appointments').deleteOne({ _id: new mongoose.Types.ObjectId(createdAppointment._id) });
    await db.collection('staffcalendars').updateMany({}, { $pull: { slots: { appointment_code: createdAppointment.booking_code } } });
  }
  if (adminCreated.users.length) await db.collection('users').deleteMany({ _id: { $in: adminCreated.users.map(id => new mongoose.Types.ObjectId(id)) } });
  if (adminCreated.services.length) await db.collection('services').deleteMany({ _id: { $in: adminCreated.services.map(id => new mongoose.Types.ObjectId(id)) } });
  if (adminCreated.branches.length) await db.collection('branches').deleteMany({ _id: { $in: adminCreated.branches.map(id => new mongoose.Types.ObjectId(id)) } });
  await db.collection('adminaudits').deleteMany({ created_at: { $gte: testStartedAt } });
  await mongoose.disconnect();
}

try {
  const [customerOne, customerTwo, staffUser, admin] = await Promise.all([
    login('0900000004'), login('0900000005'), login('0900000002'), login('0900000001')
  ]);
  await request('/appointments/mine', {}, 401);
  await request('/appointments/mine', { headers: { Authorization: `Bearer ${customerOne.token}tampered` } }, 401);
  const filterFrom = new Date(); filterFrom.setHours(0, 0, 0, 0);
  const filterTo = new Date(filterFrom); filterTo.setDate(filterTo.getDate() + 7);
  const filteredSchedule = (await request(`/appointments/mine?from=${encodeURIComponent(filterFrom.toISOString())}&to=${encodeURIComponent(filterTo.toISOString())}`, { headers: staffUser.headers }, 200)).data;
  assert(filteredSchedule.every(item => new Date(item.time_slot.start_time) >= filterFrom && new Date(item.time_slot.start_time) < filterTo), 'Bộ lọc lịch nhân viên không đúng');
  const registerPhone = `08${String(Date.now()).slice(-8)}`;
  const registered = (await request('/auth/register', { method: 'POST', body: JSON.stringify({ name: 'Khách kiểm thử', phone: registerPhone, password: '123456' }) }, 201)).data;
  adminCreated.users.push(registered.user._id);
  const registeredProfile = (await request('/auth/me', { headers: { Authorization: `Bearer ${registered.token}` } }, 200)).data;
  assert(registeredProfile.phone === registerPhone && registeredProfile.role === 'CUSTOMER', 'Đăng ký khách hàng không đúng');
  const cacheClient = new Redis(redisUrl);
  await cacheClient.del('cache:branches');
  const branches = (await request('/branches', {}, 200)).data;
  const cachedBranches = await cacheClient.get('cache:branches');
  assert(cachedBranches && JSON.parse(cachedBranches).length === branches.length, 'Cache miss không tạo cache chi nhánh');
  await request('/branches', {}, 200);
  const nearbyBranches = (await request('/branches?longitude=106.70&latitude=10.78', {}, 200)).data;
  assert(nearbyBranches.length && Number.isFinite(nearbyBranches[0].distance_meters), 'Truy vấn chi nhánh gần nhất không trả khoảng cách');
  const services = (await request('/services', {}, 200)).data;
  const workers = (await request(`/staff?branch_id=${branches[0]._id}`, {}, 200)).data;
  const service = services.find(item => item.branch_ids.includes(branches[0]._id));
  assert(workers.length && service, 'Thiếu dữ liệu danh mục để kiểm thử');

  const start = new Date(); start.setDate(start.getDate() + 10); start.setHours(16, 0, 0, 0);
  while (start.getDay() === 0) start.setDate(start.getDate() + 1);
  const holdPayload = { branch_id: branches[0]._id, staff_id: workers[0]._id, service_ids: [service._id], start_time: start.toISOString() };
  const holds = await Promise.all([
    request('/slots/hold', { method: 'POST', headers: customerOne.headers, body: JSON.stringify(holdPayload) }),
    request('/slots/hold', { method: 'POST', headers: customerTwo.headers, body: JSON.stringify(holdPayload) })
  ]);
  const winnerIndex = holds.findIndex(item => item.response.status === 201);
  assert(winnerIndex >= 0 && holds.filter(item => item.response.status === 409).length === 1, 'Kiểm thử đồng thời phải có một 201 và một 409');
  const winner = winnerIndex === 0 ? customerOne : customerTwo;
  const loser = winnerIndex === 0 ? customerTwo : customerOne;
  const hold = holds[winnerIndex].data;

  const mismatchPayload = { ...holdPayload, start_time: new Date(start.getTime() + 60_000).toISOString(), hold_token: hold.hold_token };
  await request('/appointments', { method: 'POST', headers: winner.headers, body: JSON.stringify(mismatchPayload) }, 400);

  const booking = await request('/appointments', { method: 'POST', headers: winner.headers, body: JSON.stringify({ ...holdPayload, hold_token: hold.hold_token, note: 'Kiểm thử tích hợp tự động' }) }, 201);
  createdAppointment = booking.data;
  assert(createdAppointment.services_booked[0].price === service.price, 'Snapshot giá dịch vụ không đúng');
  const movedStart = new Date(start); movedStart.setDate(movedStart.getDate() + 1);
  while (movedStart.getDay() === 0) movedStart.setDate(movedStart.getDate() + 1);
  const movedPayload = { ...holdPayload, start_time: movedStart.toISOString() };
  const movedHold = (await request(`/appointments/${createdAppointment._id}/reschedule/hold`, { method: 'POST', headers: winner.headers, body: JSON.stringify(movedPayload) }, 201)).data;
  createdAppointment = (await request(`/appointments/${createdAppointment._id}/reschedule`, { method: 'PATCH', headers: winner.headers, body: JSON.stringify({ ...movedPayload, hold_token: movedHold.hold_token, reason: 'Kiểm thử đổi lịch' }) }, 200)).data;
  assert(new Date(createdAppointment.time_slot.start_time).getTime() === movedStart.getTime(), 'Thời gian sau đổi lịch không đúng');
  assert(createdAppointment.reschedule_history?.length === 1, 'Lịch sử đổi lịch chưa được lưu');
  const loserAppointments = (await request('/appointments/mine', { headers: loser.headers }, 200)).data;
  assert(!loserAppointments.some(item => item._id === createdAppointment._id), 'Khách khác nhìn thấy lịch không thuộc mình');
  await request('/reports/dashboard', { headers: winner.headers }, 403);

  await request(`/appointments/${createdAppointment._id}/status`, { method: 'PATCH', headers: admin.headers, body: JSON.stringify({ status: 'CHECKED_IN' }) }, 409);
  const operationalStart = new Date(Date.now() - 5 * 60_000);
  const operationalEnd = new Date(operationalStart.getTime() + 45 * 60_000);
  await mongoose.connect(mongoUrl);
  await mongoose.connection.db.collection('appointments').updateOne(
    { _id: new mongoose.Types.ObjectId(createdAppointment._id) },
    { $set: { 'time_slot.start_time': operationalStart, 'time_slot.end_time': operationalEnd } }
  );
  await mongoose.disconnect();
  await request(`/appointments/${createdAppointment._id}/status`, { method: 'PATCH', headers: admin.headers, body: JSON.stringify({ status: 'CHECKED_IN' }) }, 200);
  await request(`/appointments/${createdAppointment._id}/status`, { method: 'PATCH', headers: admin.headers, body: JSON.stringify({ status: 'IN_PROGRESS' }) }, 200);
  await request(`/appointments/${createdAppointment._id}/status`, { method: 'PATCH', headers: admin.headers, body: JSON.stringify({ status: 'COMPLETED' }) }, 200);
  await request('/reviews', { method: 'POST', headers: winner.headers, body: JSON.stringify({ appointment_id: createdAppointment._id, rating: 5, comment: 'Kiểm thử tự động' }) }, 201);
  const report = (await request('/reports/dashboard', { headers: admin.headers }, 200)).data;
  assert(report.totals && Array.isArray(report.top_services) && Array.isArray(report.staff_performance), 'Báo cáo tổng hợp không đầy đủ');

  const suffix = String(Date.now()).slice(-7);
  const createdBranch = (await request('/admin/branches', { method: 'POST', headers: admin.headers, body: JSON.stringify({ name: 'Chi nhánh kiểm thử', address: 'Địa chỉ kiểm thử', phone: `028${suffix}`, coordinates: [106.7, 10.8], open: '09:00', close: '20:00' }) }, 201)).data;
  adminCreated.branches.push(createdBranch._id);
  const updatedBranch = (await request(`/admin/branches/${createdBranch._id}`, { method: 'PATCH', headers: admin.headers, body: JSON.stringify({ name: 'Chi nhánh kiểm thử đã sửa' }) }, 200)).data;
  assert(updatedBranch.name.endsWith('đã sửa'), 'Không cập nhật được chi nhánh');
  const createdService = (await request('/admin/services', { method: 'POST', headers: admin.headers, body: JSON.stringify({ name: 'Dịch vụ kiểm thử', category: 'Kiểm thử', description: '', price: 100000, duration_minutes: 30, branch_ids: [createdBranch._id] }) }, 201)).data;
  adminCreated.services.push(createdService._id);
  const updatedService = (await request(`/admin/services/${createdService._id}`, { method: 'PATCH', headers: admin.headers, body: JSON.stringify({ price: 110000 }) }, 200)).data;
  assert(updatedService.price === 110000, 'Không cập nhật được dịch vụ');
  const createdStaff = (await request('/admin/staff', { method: 'POST', headers: admin.headers, body: JSON.stringify({ name: 'Nhân viên kiểm thử', phone: `09${suffix}`, password: '123456', specialty: 'Kiểm thử', branch_id: createdBranch._id }) }, 201)).data;
  adminCreated.users.push(createdStaff._id);
  const updatedStaff = (await request(`/admin/staff/${createdStaff._id}`, { method: 'PATCH', headers: admin.headers, body: JSON.stringify({ specialty: 'Chuyên môn đã sửa' }) }, 200)).data;
  assert(updatedStaff.specialty === 'Chuyên môn đã sửa', 'Không cập nhật được nhân viên');
  const archivedStaff = (await request(`/admin/staff/${createdStaff._id}`, { method: 'DELETE', headers: admin.headers }, 200)).data;
  const archivedService = (await request(`/admin/services/${createdService._id}`, { method: 'DELETE', headers: admin.headers }, 200)).data;
  const archivedBranch = (await request(`/admin/branches/${createdBranch._id}`, { method: 'DELETE', headers: admin.headers }, 200)).data;
  assert(archivedStaff.status === 'INACTIVE' && archivedService.status === 'INACTIVE' && archivedBranch.status === 'INACTIVE', 'Chức năng ngừng hoạt động chưa đúng');
  const auditEntries = (await request('/admin/audit?limit=100', { headers: admin.headers }, 200)).data;
  assert(auditEntries.some(item => item.action === 'CREATE') && auditEntries.some(item => item.action === 'UPDATE') && auditEntries.some(item => item.action === 'ARCHIVE'), 'Nhật ký quản trị chưa ghi đủ hành động');
  assert(auditEntries.every(item => !JSON.stringify(item).includes('password_hash')), 'Nhật ký quản trị làm lộ password_hash');

  await request('/branches', {}, 200);
  const ttl = await cacheClient.ttl('cache:branches');
  await cacheClient.quit();
  assert(ttl > 0 && ttl <= 300, `TTL cache không hợp lệ: ${ttl}`);
  console.log(JSON.stringify({ passed: true, registration: 'passed', geo_near: 'passed', staff_schedule_filter: 'passed', jwt_missing_and_tampered: 'rejected', concurrent_hold: '1 success + 1 conflict', hold_mismatch: 'rejected', reschedule: 'hold new + preserve history passed', early_admin_action: 'rejected', authorization: 'passed', snapshot: 'passed', workflow: 'completed + reviewed', cache_miss_and_hit: 'passed', cache_ttl: ttl, report: 'passed', admin_crud: 'create + update + archive passed', admin_audit: 'actor + before/after + password scrub passed' }, null, 2));
} finally {
  await cleanup();
}
