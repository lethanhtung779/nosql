import { SpaService } from './spa.service';

describe('SpaService rollback', () => {
  it('gỡ slot khỏi lịch nhân viên khi tạo appointment thất bại', async () => {
    const userId = '507f1f77bcf86cd799439011';
    const branchId = '507f1f77bcf86cd799439012';
    const staffId = '507f1f77bcf86cd799439013';
    const serviceId = '507f1f77bcf86cd799439014';
    const start = new Date(Date.now() + 86_400_000).toISOString();
    const end = new Date(new Date(start).getTime() + 30 * 60_000).toISOString();
    const hold = { token: 'hold-token', userId, branchId, staffId, serviceIds: [serviceId], startTime: start, endTime: end };
    const users = {
      findById: jest.fn().mockResolvedValue({ _id: userId, name: 'Khách', phone: '0900000000' }),
      findOne: jest.fn().mockResolvedValue({ _id: staffId, name: 'Nhân viên' })
    };
    const branches = { findOne: jest.fn().mockResolvedValue({ _id: branchId }) };
    const services = { find: jest.fn().mockResolvedValue([{ _id: serviceId, name: 'Dịch vụ', price: 100000, duration_minutes: 30 }]) };
    const appointments = { create: jest.fn().mockRejectedValue(new Error('Mongo write failed')) };
    const reviews = {};
    const calendars = { findOneAndUpdate: jest.fn().mockResolvedValue({}), updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }) };
    const redis = { getHold: jest.fn().mockResolvedValue(hold), releaseHold: jest.fn() };
    const spa = new SpaService(users as any, branches as any, services as any, appointments as any, reviews as any, calendars as any, redis as any);

    await expect(spa.book({ branch_id: branchId, staff_id: staffId, service_ids: [serviceId], start_time: start, hold_token: 'hold-token' }, userId)).rejects.toThrow('Mongo write failed');
    expect(calendars.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(calendars.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ staff_id: staffId }),
      expect.objectContaining({ $pull: { slots: { appointment_code: expect.any(String) } } })
    );
    expect(redis.releaseHold).not.toHaveBeenCalled();
  });
});
