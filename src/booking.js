const { getDb } = require('./db');
const { objectId, dateValue, bookingCode, dateKey } = require('./utils');

const ACTIVE_STATUSES = ['HOLD', 'CONFIRMED', 'IN_PROGRESS'];

function overlaps(existingStart, existingEnd, newStart, newEnd) {
  return existingStart < newEnd && existingEnd > newStart;
}

async function buildBooking(input, customerId) {
  const db = getDb();
  const branchId = objectId(input.branch_id, 'branch_id');
  const staffId = objectId(input.staff_id, 'staff_id');
  const serviceIds = [...new Set(input.service_ids || [])].map((id) => objectId(id, 'service_id'));
  if (!serviceIds.length) throw Object.assign(new Error('Vui lòng chọn ít nhất một dịch vụ'), { status: 400 });

  const [customer, staff, branch, services] = await Promise.all([
    db.collection('users').findOne({ _id: customerId, status: 'ACTIVE' }),
    db.collection('users').findOne({ _id: staffId, role: 'STAFF', status: 'ACTIVE', branch_id: branchId }),
    db.collection('branches').findOne({ _id: branchId, status: 'ACTIVE' }),
    db.collection('services').find({ _id: { $in: serviceIds }, branch_ids: branchId, status: 'ACTIVE' }).toArray()
  ]);
  if (!customer || !staff || !branch || services.length !== serviceIds.length) {
    throw Object.assign(new Error('Khách hàng, chi nhánh, nhân viên hoặc dịch vụ không hợp lệ'), { status: 400 });
  }

  const start = dateValue(input.start_time, 'start_time');
  if (start <= new Date()) throw Object.assign(new Error('Thời gian hẹn phải ở tương lai'), { status: 400 });
  const duration = services.reduce((sum, service) => sum + service.duration_minutes, 0);
  const end = new Date(start.getTime() + duration * 60000);
  const [openHour, openMinute] = branch.opening_hours.open.split(':').map(Number);
  const [closeHour, closeMinute] = branch.opening_hours.close.split(':').map(Number);
  const localStartMinutes = start.getUTCHours() * 60 + start.getUTCMinutes() + 7 * 60;
  const localEndMinutes = localStartMinutes + duration;
  if (localStartMinutes < openHour * 60 + openMinute || localEndMinutes > closeHour * 60 + closeMinute) {
    throw Object.assign(new Error('Khung giờ nằm ngoài giờ hoạt động của chi nhánh'), { status: 400 });
  }

  return {
    booking_code: bookingCode(), branch_id: branchId,
    customer: { user_id: customerId, name: customer.name, phone: customer.phone },
    staff: { staff_id: staffId, name: staff.name },
    time_slot: { start_time: start, end_time: end },
    services_booked: services.map((s) => ({ service_id: s._id, name: s.name, price: s.price, duration: s.duration_minutes })),
    total_amount: services.reduce((sum, service) => sum + service.price, 0),
    note: String(input.note || '').trim().slice(0, 500),
    status: 'CONFIRMED', created_at: new Date(), updated_at: new Date()
  };
}

async function createAppointment(input, customerId) {
  const db = getDb();
  const appointment = await buildBooking(input, customerId);
  const { staff_id } = appointment.staff;
  const { start_time, end_time } = appointment.time_slot;
  const slot = { appointment_code: appointment.booking_code, start_time, end_time, status: appointment.status };

  const filter = {
    staff_id,
    date_key: dateKey(start_time),
    slots: { $not: { $elemMatch: { status: { $in: ACTIVE_STATUSES }, start_time: { $lt: end_time }, end_time: { $gt: start_time } } } }
  };
  const update = { $setOnInsert: { staff_id, date_key: dateKey(start_time), created_at: new Date() }, $push: { slots: slot }, $set: { updated_at: new Date() } };
  try {
    const calendar = await db.collection('staff_calendars').findOneAndUpdate(filter, update, { upsert: true, returnDocument: 'after' });
    if (!calendar) throw Object.assign(new Error('Khung giờ này thợ đã bận, vui lòng chọn giờ khác'), { status: 409 });
  } catch (error) {
    if (error.code === 11000) throw Object.assign(new Error('Khung giờ này thợ đã bận, vui lòng chọn giờ khác'), { status: 409 });
    throw error;
  }

  try {
    const result = await db.collection('appointments').insertOne(appointment);
    return { ...appointment, _id: result.insertedId };
  } catch (error) {
    await db.collection('staff_calendars').updateOne({ staff_id, date_key: dateKey(start_time) }, { $pull: { slots: { appointment_code: appointment.booking_code } } });
    throw error;
  }
}

module.exports = { overlaps, buildBooking, createAppointment, ACTIVE_STATUSES };
