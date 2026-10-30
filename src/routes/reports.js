const express = require('express');
const { getDb } = require('../db');
const { authenticate, allow } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, allow('ADMIN'));

router.get('/dashboard', async (req, res) => {
  const db = getDb();
  const start = req.query.from ? new Date(req.query.from) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const end = req.query.to ? new Date(req.query.to) : new Date();
  const match = { status: 'COMPLETED', 'time_slot.start_time': { $gte: start, $lte: end } };
  const [revenueByBranch, topServices, staffPerformance, totals] = await Promise.all([
    db.collection('appointments').aggregate([
      { $match: match }, { $group: { _id: '$branch_id', revenue: { $sum: '$total_amount' }, appointments: { $sum: 1 } } },
      { $lookup: { from: 'branches', localField: '_id', foreignField: '_id', as: 'branch' } },
      { $set: { branch_name: { $first: '$branch.name' } } }, { $project: { branch: 0 } }, { $sort: { revenue: -1 } }
    ]).toArray(),
    db.collection('appointments').aggregate([
      { $match: match }, { $unwind: '$services_booked' },
      { $group: { _id: '$services_booked.service_id', name: { $first: '$services_booked.name' }, bookings: { $sum: 1 }, revenue: { $sum: '$services_booked.price' } } },
      { $sort: { bookings: -1 } }, { $limit: 5 }
    ]).toArray(),
    db.collection('reviews').aggregate([
      { $group: { _id: '$staff_id', average_rating: { $avg: '$rating' }, review_count: { $sum: 1 } } },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'staff' } },
      { $set: { staff_name: { $first: '$staff.name' } } }, { $project: { staff: 0 } }, { $sort: { average_rating: -1 } }
    ]).toArray(),
    db.collection('appointments').aggregate([{ $match: match }, { $group: { _id: null, revenue: { $sum: '$total_amount' }, appointments: { $sum: 1 } } }]).next()
  ]);
  res.json({ period: { from: start, to: end }, totals: totals || { revenue: 0, appointments: 0 }, revenue_by_branch: revenueByBranch, top_services: topServices, staff_performance: staffPerformance });
});

module.exports = router;
