const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDb } = require('../db');
const config = require('../config');
const { publicUser } = require('../utils');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.post('/register', async (req, res) => {
  const { name, phone, password } = req.body;
  if (!name?.trim() || !/^0\d{9}$/.test(phone || '') || (password || '').length < 6) {
    return res.status(400).json({ message: 'Họ tên, số điện thoại 10 số và mật khẩu tối thiểu 6 ký tự là bắt buộc' });
  }
  const user = { name: name.trim(), phone, password_hash: await bcrypt.hash(password, 12), role: 'CUSTOMER', status: 'ACTIVE', created_at: new Date() };
  const result = await getDb().collection('users').insertOne(user);
  res.status(201).json(issueToken({ ...user, _id: result.insertedId }));
});

router.post('/login', async (req, res) => {
  const user = await getDb().collection('users').findOne({ phone: req.body.phone, status: 'ACTIVE' });
  if (!user || !(await bcrypt.compare(req.body.password || '', user.password_hash))) {
    return res.status(401).json({ message: 'Số điện thoại hoặc mật khẩu không đúng' });
  }
  res.json(issueToken(user));
});

router.get('/me', authenticate, async (req, res) => {
  const { ObjectId } = require('mongodb');
  const user = await getDb().collection('users').findOne({ _id: new ObjectId(req.user.sub) });
  res.json(publicUser(user));
});

function issueToken(user) {
  const token = jwt.sign({ sub: user._id.toString(), role: user.role, name: user.name }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
  return { token, user: publicUser(user) };
}

module.exports = router;
