const test = require('node:test');
const assert = require('node:assert/strict');
const { overlaps } = require('../src/booking');

test('phát hiện hai khung giờ giao nhau', () => {
  const start = new Date('2026-10-30T02:00:00Z');
  const end = new Date('2026-10-30T03:00:00Z');
  assert.equal(overlaps(start, end, new Date('2026-10-30T02:30:00Z'), new Date('2026-10-30T03:30:00Z')), true);
});

test('cho phép hai khung giờ nối tiếp nhau', () => {
  const start = new Date('2026-10-30T02:00:00Z');
  const end = new Date('2026-10-30T03:00:00Z');
  assert.equal(overlaps(start, end, end, new Date('2026-10-30T04:00:00Z')), false);
});
