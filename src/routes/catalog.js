const express = require('express');
const { getDb } = require('../db');
const { objectId } = require('../utils');

const router = express.Router();

router.get('/branches', async (req, res) => {
  const db = getDb();
  const longitude = Number(req.query.longitude);
  const latitude = Number(req.query.latitude);
  let items;
  if (Number.isFinite(longitude) && Number.isFinite(latitude)) {
    items = await db.collection('branches').aggregate([
      { $geoNear: { near: { type: 'Point', coordinates: [longitude, latitude] }, distanceField: 'distance_meters', spherical: true, query: { status: 'ACTIVE' } } },
      { $limit: 20 }
    ]).toArray();
  } else {
    items = await db.collection('branches').find({ status: 'ACTIVE' }).toArray();
  }
  res.json(items);
});

router.get('/services', async (req, res) => {
  const filter = { status: 'ACTIVE' };
  if (req.query.branch_id) filter.branch_ids = objectId(req.query.branch_id, 'branch_id');
  res.json(await getDb().collection('services').find(filter).sort({ category: 1, name: 1 }).toArray());
});

router.get('/staff', async (req, res) => {
  const filter = { role: 'STAFF', status: 'ACTIVE' };
  if (req.query.branch_id) filter.branch_id = objectId(req.query.branch_id, 'branch_id');
  res.json(await getDb().collection('users').find(filter, { projection: { password_hash: 0 } }).toArray());
});

module.exports = router;
