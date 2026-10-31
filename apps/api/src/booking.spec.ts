import { canTransition, overlaps, totalDuration } from './booking-rules';

describe('Quy tắc đặt lịch', () => {
  it('phát hiện hai khoảng giao nhau', () => {
    expect(overlaps(new Date(1), new Date(5), new Date(3), new Date(7))).toBe(true);
  });
  it('cho phép hai khoảng nối tiếp', () => {
    expect(overlaps(new Date(1), new Date(5), new Date(5), new Date(7))).toBe(false);
  });
  it('yêu cầu check-in trước khi bắt đầu phục vụ', () => {
    expect(canTransition('CONFIRMED', 'IN_PROGRESS')).toBe(false);
    expect(canTransition('CONFIRMED', 'CHECKED_IN')).toBe(true);
    expect(canTransition('CHECKED_IN', 'IN_PROGRESS')).toBe(true);
  });
  it('không cho phép hoàn thành trực tiếp từ lịch xác nhận', () => {
    expect(canTransition('CONFIRMED', 'COMPLETED')).toBe(false);
  });
  it('không cho phép thay đổi lịch đã hoàn thành', () => {
    expect(canTransition('COMPLETED', 'CANCELLED')).toBe(false);
  });
  it('phát hiện khoảng nằm hoàn toàn bên trong khoảng khác', () => {
    expect(overlaps(new Date(2), new Date(4), new Date(1), new Date(8))).toBe(true);
  });
  it('không coi hai khoảng tách rời là giao nhau', () => {
    expect(overlaps(new Date(1), new Date(2), new Date(3), new Date(4))).toBe(false);
  });
  it('tính tổng thời lượng của nhiều dịch vụ', () => {
    expect(totalDuration([{ duration_minutes: 45 }, { duration_minutes: 30 }])).toBe(75);
  });
  it('cho phép khách hủy lịch đã xác nhận', () => {
    expect(canTransition('CONFIRMED', 'CANCELLED')).toBe(true);
  });
  it('không cho phép hủy khi đang phục vụ', () => {
    expect(canTransition('IN_PROGRESS', 'CANCELLED')).toBe(false);
  });
  it('cho phép đánh dấu khách vắng từ lịch đã xác nhận', () => {
    expect(canTransition('CONFIRMED', 'NO_SHOW')).toBe(true);
  });
});
