const { MongoClient } = require('mongodb');
const config = require('./config');

let client;
let database;

async function connectDb() {
  if (database) return database;
  client = new MongoClient(config.mongoUri);
  await client.connect();
  database = client.db(config.dbName);
  await ensureIndexes(database);
  return database;
}

async function ensureIndexes(db) {
  await Promise.all([
    db.collection('users').createIndex({ phone: 1 }, { unique: true }),
    db.collection('branches').createIndex({ location: '2dsphere' }),
    db.collection('services').createIndex({ branch_ids: 1, status: 1 }),
    db.collection('appointments').createIndex({ 'staff.staff_id': 1, 'time_slot.start_time': 1, status: 1 }),
    db.collection('appointments').createIndex({ 'customer.user_id': 1, created_at: -1 }),
    db.collection('appointments').createIndex({ booking_code: 1 }, { unique: true }),
    db.collection('reviews').createIndex({ appointment_id: 1 }, { unique: true }),
    db.collection('temp_slots').createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 }),
    db.collection('staff_calendars').createIndex({ staff_id: 1, date_key: 1 }, { unique: true })
  ]);
}

function getDb() {
  if (!database) throw new Error('Cơ sở dữ liệu chưa kết nối');
  return database;
}

async function closeDb() {
  if (client) await client.close();
  client = undefined;
  database = undefined;
}

module.exports = { connectDb, getDb, closeDb };
