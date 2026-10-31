import mongoose from 'mongoose';

const mongoUrl = process.env.MONGODB_URI || 'mongodb://localhost:27017/spa_salon';
await mongoose.connect(mongoUrl);
const db = mongoose.connection.db;
const appointmentIndexes = await db.collection('appointments').indexes();
const branchIndexes = await db.collection('branches').indexes();
const staff = await db.collection('users').findOne({ role: 'STAFF' });
const query = { 'staff.staff_id': staff?._id, status: { $in: ['CONFIRMED', 'IN_PROGRESS'] }, 'time_slot.start_time': { $gte: new Date(0) } };
const explanation = await db.collection('appointments').find(query).explain('executionStats');
console.log(JSON.stringify({
  appointment_indexes: appointmentIndexes.map(index => index.name),
  branch_indexes: branchIndexes.map(index => index.name),
  winning_plan: explanation.queryPlanner?.winningPlan || explanation.queryPlanner,
  examined: explanation.executionStats?.totalDocsExamined,
  returned: explanation.executionStats?.nReturned
}, null, 2));
await mongoose.disconnect();
