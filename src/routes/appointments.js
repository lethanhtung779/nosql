const express = require('express');
const { ObjectId } = require('mongodb');
const { getDb } = require('../db');
const { authenticate, allow } = require('../middleware/auth');
const { objectId, dateKey } = require('../utils');
const { createAppointment } = require('../booking');

const router = express.Router();
router.use(authenticate);

router.post('/', allow('CUSTOMER'), async (req, res) => {
  const appointment = await createAppointment(req.body, new ObjectId(req.user.sub));
  res.status(201).json(appointment);
});

router.get('/mine', async (req, res) => {
  const userId = new ObjectId(req.user.sub);
  const filter = req.user.role === 'CUSTOMER' ? { 'customer.user_id': userId } : req.user.role === 'STAFF' ? { 'staff.staff_id': userId } : {};
  res.json(await getDb().collection('appointments').find(filter).sort({ 'time_slot.start_time': -1 }).limit(100).toArray());
});

router.patch('/:id/status', allow('STAFF', 'ADMIN'), async (req, res) => {
  const next = req.body.status;
  const allowed = ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
  if (!allowed.includes(next)) return res.status(400).json({ message: 'Trạng thái không hợp lệ' });
  const db = getDb();
  const filter = { _id: objectId(req.params.id) };
  if (req.user.role === 'STAFF') filter['staff.staff_id'] = new ObjectId(req.user.sub);
  const appointment = await db.collection('appointments').findOneAndUpdate(filter, { $set: { status: next, updated_at: new Date() } }, { returnDocument: 'after' });
  if (!appointment) return res.status(404).json({ message: 'Không tìm thấy lịch hẹn' });
  await db.collection('staff_calendars').updateOne(
    { staff_id: appointment.staff.staff_id, date_key: dateKey(appointment.time_slot.start_time), 'slots.appointment_code': appointment.booking_code },
    { $set: { 'slots.$.status': next, updated_at: new Date() } }
  );
  res.json(appointment);
});

router.patch('/:id/cancel', allow('CUSTOMER'), async (req, res) => {
  const db = getDb();
  const appointment = await db.collection('appointments').findOneAndUpdate(
    { _id: objectId(req.params.id), 'customer.user_id': new ObjectId(req.user.sub), status: { $in: ['PENDING', 'CONFIRMED'] }, 'time_slot.start_time': { $gt: new Date() } },
    { $set: { status: 'CANCELLED', updated_at: new Date() } }, { returnDocument: 'after' }
  );
  if (!appointment) return res.status(409).json({ message: 'Không thể hủy lịch hẹn này' });
  await db.collection('staff_calendars').updateOne(
    { staff_id: appointment.staff.staff_id, date_key: dateKey(appointment.time_slot.start_time), 'slots.appointment_code': appointment.booking_code },
    { $set: { 'slots.$.status': 'CANCELLED', updated_at: new Date() } }
  );
  res.json(appointment);
});

module.exports = router;
