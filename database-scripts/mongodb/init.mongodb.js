// Chạy bằng mongosh. Script chỉ tạo/cập nhật cấu trúc, không xóa dữ liệu.
const salonDb = db.getSiblingDB('spa_salon');

function ensureCollection(name, validator) {
  const exists = salonDb.getCollectionInfos({ name }).length > 0;
  if (!exists) salonDb.createCollection(name, { validator });
  else salonDb.runCommand({ collMod: name, validator, validationLevel: 'moderate' });
}

const objectId = { bsonType: 'objectId' };
const date = { bsonType: 'date' };

ensureCollection('users', {
  $jsonSchema: {
    bsonType: 'object', required: ['name', 'phone', 'password_hash'],
    properties: {
      name: { bsonType: 'string' }, phone: { bsonType: 'string' }, password_hash: { bsonType: 'string' },
      role: { enum: ['CUSTOMER', 'STAFF', 'ADMIN'] }, branch_id: objectId, specialty: { bsonType: 'string' },
      working_days: { bsonType: 'array', items: { bsonType: 'number' } },
      working_hours: { bsonType: 'object', properties: { open: { bsonType: 'string' }, close: { bsonType: 'string' } } },
      break_hours: { bsonType: 'object', properties: { start: { bsonType: 'string' }, end: { bsonType: 'string' } } },
      days_off: { bsonType: 'array', items: { bsonType: 'string' } }, status: { bsonType: 'string' },
      created_at: date, updated_at: date
    }
  }
});

ensureCollection('branches', {
  $jsonSchema: { bsonType: 'object', properties: {
    name: { bsonType: 'string' }, address: { bsonType: 'string' }, phone: { bsonType: 'string' },
    location: { bsonType: 'object', properties: { type: { enum: ['Point'] }, coordinates: { bsonType: 'array', items: { bsonType: 'number' } } } },
    opening_hours: { bsonType: 'object' }, status: { bsonType: 'string' }, created_at: date, updated_at: date
  } }
});

ensureCollection('services', {
  $jsonSchema: { bsonType: 'object', properties: {
    name: { bsonType: 'string' }, category: { bsonType: 'string' }, description: { bsonType: 'string' },
    price: { bsonType: 'number' }, duration_minutes: { bsonType: 'number' }, is_estimated: { bsonType: 'bool' },
    branch_ids: { bsonType: 'array', items: objectId }, steps: { bsonType: 'array' }, status: { bsonType: 'string' },
    created_at: date, updated_at: date
  } }
});

ensureCollection('appointments', {
  $jsonSchema: { bsonType: 'object', required: ['booking_code'], properties: {
    booking_code: { bsonType: 'string' }, branch_id: objectId,
    customer: { bsonType: 'object', properties: { user_id: objectId, name: { bsonType: 'string' }, phone: { bsonType: 'string' } } },
    staff: { bsonType: 'object', properties: { staff_id: objectId, name: { bsonType: 'string' } } },
    time_slot: { bsonType: 'object', properties: { start_time: date, end_time: date } },
    services_booked: { bsonType: 'array' }, total_amount: { bsonType: 'number' }, note: { bsonType: 'string' },
    status: { bsonType: 'string' }, checked_in_at: date, started_at: date, completed_at: date,
    status_history: { bsonType: 'array' }, reschedule_history: { bsonType: 'array' }, created_at: date, updated_at: date
  } }
});

ensureCollection('reviews', { $jsonSchema: { bsonType: 'object', properties: {
  appointment_id: objectId, customer_id: objectId, staff_id: objectId,
  rating: { bsonType: 'number', minimum: 1, maximum: 5 }, comment: { bsonType: 'string' }, images: { bsonType: 'array' },
  created_at: date, updated_at: date
} } });

ensureCollection('staffcalendars', { $jsonSchema: { bsonType: 'object', properties: {
  staff_id: objectId, date_key: { bsonType: 'string' }, slots: { bsonType: 'array' }, created_at: date, updated_at: date
} } });

ensureCollection('categories', { $jsonSchema: { bsonType: 'object', required: ['name'], properties: {
  name: { bsonType: 'string' }, description: { bsonType: 'string' }, status: { bsonType: 'string' }, created_at: date, updated_at: date
} } });

ensureCollection('adminaudits', { $jsonSchema: { bsonType: 'object', properties: {
  actor: { bsonType: 'object' }, action: { enum: ['CREATE', 'UPDATE', 'ARCHIVE', 'STATUS_CHANGE'] },
  entity_type: { bsonType: 'string' }, entity_id: objectId, before: {}, after: {}, created_at: date, updated_at: date
} } });

salonDb.users.createIndex({ phone: 1 }, { unique: true });
salonDb.branches.createIndex({ location: '2dsphere' });
salonDb.appointments.createIndex({ booking_code: 1 }, { unique: true });
salonDb.appointments.createIndex({ 'staff.staff_id': 1, 'time_slot.start_time': 1, status: 1 });
salonDb.reviews.createIndex({ appointment_id: 1 }, { unique: true });
salonDb.staffcalendars.createIndex({ staff_id: 1, date_key: 1 }, { unique: true });
salonDb.categories.createIndex({ name: 1 }, { unique: true });
salonDb.adminaudits.createIndex({ created_at: -1 });
salonDb.adminaudits.createIndex({ entity_type: 1, entity_id: 1, created_at: -1 });

print('MongoDB schema and indexes are ready for spa_salon.');

