const { ObjectId } = require('mongodb');

function objectId(value, field = 'id') {
  if (!ObjectId.isValid(value)) {
    const error = new Error(`${field} không hợp lệ`);
    error.status = 400;
    throw error;
  }
  return new ObjectId(value);
}

function dateValue(value, field) {
  const result = new Date(value);
  if (!value || Number.isNaN(result.getTime())) {
    const error = new Error(`${field} không hợp lệ`);
    error.status = 400;
    throw error;
  }
  return result;
}

function bookingCode(now = new Date()) {
  const stamp = now.toISOString().slice(0, 10).replaceAll('-', '');
  const suffix = crypto.randomUUID().slice(0, 6).toUpperCase();
  return `BK-${stamp}-${suffix}`;
}

function publicUser(user) {
  if (!user) return null;
  const { password_hash, ...safe } = user;
  return safe;
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

module.exports = { objectId, dateValue, bookingCode, publicUser, dateKey };
