const express = require('express');
const { ObjectId } = require('mongodb');
const { getDb } = require('../db');
const { authenticate, allow } = require('../middleware/auth');
const { objectId } = require('../utils');

const router = express.Router();

router.get('/', async (req, res) => {
  const filter = {};
  if (req.query.staff_id) filter.staff_id = objectId(req.query.staff_id, 'staff_id');
  res.json(await getDb().collection('reviews').find(filter).sort({ created_at: -1 }).limit(100).toArray());
});

router.post('/', authenticate, allow('CUSTOMER'), async (req, res) => {
  const rating = Number(req.body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ message: 'Điểm đánh giá phải từ 1 đến 5' });
  const db = getDb();
  const customerId = new ObjectId(req.user.sub);
  const appointment = await db.collection('appointments').findOne({ _id: objectId(req.body.appointment_id), 'customer.user_id': customerId, status: 'COMPLETED' });
  if (!appointment) return res.status(400).json({ message: 'Chỉ có thể đánh giá lịch hẹn đã hoàn thành' });
  const review = {
    appointment_id: appointment._id, customer_id: customerId, staff_id: appointment.staff.staff_id,
    rating, comment: String(req.body.comment || '').trim().slice(0, 1000), images: [], created_at: new Date()
  };
  const result = await db.collection('reviews').insertOne(review);
  res.status(201).json({ ...review, _id: result.insertedId });
});

module.exports = router;
