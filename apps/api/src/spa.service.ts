import {
  BadRequestException, ConflictException, ForbiddenException,
  Injectable, NotFoundException
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { RedisService, SlotHold } from './redis.service';
import { ACTIVE_APPOINTMENT_STATUSES, canTransition } from './booking-rules';

@Injectable()
export class SpaService {
  constructor(
    @InjectModel('User') private users: Model<any>,
    @InjectModel('Branch') private branches: Model<any>,
    @InjectModel('Service') private services: Model<any>,
    @InjectModel('Appointment') private appointments: Model<any>,
    @InjectModel('Review') private reviews: Model<any>,
    @InjectModel('StaffCalendar') private calendars: Model<any>,
    private redis: RedisService
  ) {}

  publicUser(user: any) {
    if (!user) return null;
    const value = user.toObject ? user.toObject() : { ...user };
    delete value.password_hash;
    return value;
  }

  findUser(id: string) { return this.users.findById(id); }
  findUserByPhone(phone: string) { return this.users.findOne({ phone, status: 'ACTIVE' }); }

  async createUser(name: string, phone: string, password: string) {
    if (await this.users.exists({ phone })) throw new ConflictException('Số điện thoại đã tồn tại');
    return this.users.create({
      name, phone, password_hash: await bcrypt.hash(password, 12),
      role: 'CUSTOMER', status: 'ACTIVE'
    });
  }

  async listBranches(longitude?: number, latitude?: number) {
    if (Number.isFinite(longitude) && Number.isFinite(latitude)) {
      return this.branches.aggregate([
        { $geoNear: { near: { type: 'Point', coordinates: [longitude!, latitude!] }, distanceField: 'distance_meters', spherical: true, query: { status: 'ACTIVE' } } },
        { $limit: 20 }
      ]);
    }
    const cached = await this.redis.cacheGet<any[]>('branches');
    if (cached) return cached;
    const data = await this.branches.find({ status: 'ACTIVE' }).lean();
    await this.redis.cacheSet('branches', data);
    return data;
  }

  async listServices(branchId?: string) {
    if (branchId && !Types.ObjectId.isValid(branchId)) throw new BadRequestException('Chi nhánh không hợp lệ');
    const key = `services:${branchId || 'all'}`;
    const cached = await this.redis.cacheGet<any[]>(key);
    if (cached) return cached;
    const data = await this.services.find({
      status: 'ACTIVE',
      ...(branchId ? { branch_ids: new Types.ObjectId(branchId) } : {})
    }).sort({ category: 1, name: 1 }).lean();
    await this.redis.cacheSet(key, data);
    return data;
  }

  listStaff(branchId?: string) {
    if (branchId && !Types.ObjectId.isValid(branchId)) throw new BadRequestException('Chi nhánh không hợp lệ');
    return this.users.find({
      role: 'STAFF', status: 'ACTIVE',
      ...(branchId ? { branch_id: new Types.ObjectId(branchId) } : {})
    }).select('-password_hash');
  }

  async holdSlot(input: any, userId: string) {
    const [staff, services] = await Promise.all([
      this.users.findOne({ _id: input.staff_id, role: 'STAFF', branch_id: input.branch_id, status: 'ACTIVE' }),
      this.services.find({ _id: { $in: input.service_ids }, branch_ids: input.branch_id, status: 'ACTIVE' })
    ]);
    if (!staff || services.length !== new Set(input.service_ids).size) {
      throw new BadRequestException('Chuyên viên hoặc dịch vụ không hợp lệ');
    }
    const start = new Date(input.start_time);
    if (Number.isNaN(start.getTime()) || start <= new Date()) {
      throw new BadRequestException('Thời gian hẹn phải ở tương lai');
    }
    const duration = services.reduce((sum, service) => sum + service.duration_minutes, 0);
    const end = new Date(start.getTime() + duration * 60_000);
    const conflict = await this.appointments.exists({
      'staff.staff_id': staff._id,
      status: { $in: ACTIVE_APPOINTMENT_STATUSES },
      'time_slot.start_time': { $lt: end },
      'time_slot.end_time': { $gt: start }
    });
    if (conflict) throw new ConflictException('Khung giờ này chuyên viên đã bận');

    const hold: SlotHold = {
      token: crypto.randomUUID(), userId, staffId: input.staff_id,
      branchId: input.branch_id, serviceIds: [...input.service_ids].sort(),
      startTime: start.toISOString(), endTime: end.toISOString()
    };
    if (!(await this.redis.acquireHold(hold))) {
      throw new ConflictException('Khung giờ đang được khách khác giữ');
    }
    return {
      hold_token: hold.token,
      expires_in_seconds: 900,
      expires_at: new Date(Date.now() + 900_000),
      time_slot: { start_time: start, end_time: end }
    };
  }

  async getHold(token: string, userId: string) {
    const hold = await this.redis.getHoldStatus(token);
    if (!hold) throw new NotFoundException('Phiên giữ chỗ đã hết hạn hoặc không tồn tại');
    if (hold.userId !== userId) throw new ForbiddenException('Phiên giữ chỗ không thuộc tài khoản này');
    return hold;
  }

  async releaseHold(token: string, userId: string) {
    const hold = await this.redis.getHold(token);
    if (!hold) return { released: true };
    if (hold.userId !== userId) throw new ForbiddenException('Phiên giữ chỗ không thuộc tài khoản này');
    await this.redis.releaseHold(hold);
    return { released: true };
  }

  async book(input: any, userId: string) {
    const hold = await this.redis.getHold(input.hold_token);
    if (!hold || hold.userId !== userId) {
      throw new ConflictException('Phiên giữ chỗ không tồn tại hoặc đã hết 15 phút');
    }
    const same = hold.staffId === input.staff_id && hold.branchId === input.branch_id
      && hold.startTime === new Date(input.start_time).toISOString()
      && JSON.stringify(hold.serviceIds) === JSON.stringify([...input.service_ids].sort());
    if (!same) throw new BadRequestException('Thông tin đặt lịch không khớp với phiên giữ chỗ');

    const [customer, branch, staff, services] = await Promise.all([
      this.users.findById(userId),
      this.branches.findOne({ _id: input.branch_id, status: 'ACTIVE' }),
      this.users.findOne({ _id: input.staff_id, role: 'STAFF', branch_id: input.branch_id, status: 'ACTIVE' }),
      this.services.find({ _id: { $in: input.service_ids }, branch_ids: input.branch_id, status: 'ACTIVE' })
    ]);
    if (!customer || !branch || !staff || services.length !== new Set(input.service_ids).size) {
      throw new BadRequestException('Thông tin đặt lịch không hợp lệ');
    }

    const start = new Date(hold.startTime);
    const end = new Date(hold.endTime);
    const bookingCode = `BK-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
    const dateKey = start.toISOString().slice(0, 10);
    const calendarFilter = {
      staff_id: staff._id, date_key: dateKey,
      slots: { $not: { $elemMatch: {
        status: { $in: ACTIVE_APPOINTMENT_STATUSES },
        start_time: { $lt: end }, end_time: { $gt: start }
      } } }
    };
    try {
      await this.calendars.findOneAndUpdate(calendarFilter, {
        $setOnInsert: { staff_id: staff._id, date_key: dateKey },
        $push: { slots: { appointment_code: bookingCode, start_time: start, end_time: end, status: 'CONFIRMED' } }
      }, { upsert: true, new: true });
    } catch (error: any) {
      if (error.code === 11000) throw new ConflictException('Khung giờ này chuyên viên đã bận');
      throw error;
    }

    try {
      const appointment = await this.appointments.create({
        booking_code: bookingCode, branch_id: branch._id,
        customer: { user_id: customer._id, name: customer.name, phone: customer.phone },
        staff: { staff_id: staff._id, name: staff.name },
        time_slot: { start_time: start, end_time: end },
        services_booked: services.map(service => ({
          service_id: service._id, name: service.name,
          price: service.price, duration: service.duration_minutes
        })),
        total_amount: services.reduce((sum, service) => sum + service.price, 0),
        note: String(input.note || '').slice(0, 500), status: 'CONFIRMED'
      });
      await this.redis.releaseHold(hold);
      return appointment;
    } catch (error) {
      await this.calendars.updateOne(
        { staff_id: staff._id, date_key: dateKey },
        { $pull: { slots: { appointment_code: bookingCode } } }
      );
      throw error;
    }
  }

  listAppointments(user: any, from?: string, to?: string) {
    const filter: any = user.role === 'CUSTOMER'
      ? { 'customer.user_id': new Types.ObjectId(user.sub) }
      : user.role === 'STAFF'
        ? { 'staff.staff_id': new Types.ObjectId(user.sub) }
        : {};
    if (from || to) {
      filter['time_slot.start_time'] = {};
      if (from) filter['time_slot.start_time'].$gte = new Date(from);
      if (to) filter['time_slot.start_time'].$lt = new Date(to);
    }
    return this.appointments.find(filter).sort({ 'time_slot.start_time': -1 }).limit(200);
  }

  async getAppointment(id: string, user: any) {
    const appointment = await this.appointments.findById(id);
    if (!appointment) throw new NotFoundException('Không tìm thấy lịch hẹn');
    const allowed = user.role === 'ADMIN'
      || (user.role === 'CUSTOMER' && appointment.customer.user_id.toString() === user.sub)
      || (user.role === 'STAFF' && appointment.staff.staff_id.toString() === user.sub);
    if (!allowed) throw new ForbiddenException('Bạn không có quyền xem lịch hẹn này');
    return appointment;
  }

  async setStatus(id: string, status: string, user: any) {
    const filter: any = { _id: id };
    if (user.role === 'STAFF') filter['staff.staff_id'] = user.sub;
    const current = await this.appointments.findOne(filter);
    if (!current) throw new NotFoundException('Không tìm thấy lịch hẹn');
    if (!canTransition(current.status, status)) {
      throw new ConflictException(`Không thể chuyển từ ${current.status} sang ${status}`);
    }
    current.status = status;
    await current.save();
    await this.syncCalendarStatus(current, status);
    return current;
  }

  async cancelAppointment(id: string, userId: string) {
    const appointment = await this.appointments.findOne({ _id: id, 'customer.user_id': userId });
    if (!appointment) throw new NotFoundException('Không tìm thấy lịch hẹn');
    if (!canTransition(appointment.status, 'CANCELLED')) {
      throw new ConflictException('Lịch hẹn này không thể hủy');
    }
    appointment.status = 'CANCELLED';
    await appointment.save();
    await this.syncCalendarStatus(appointment, 'CANCELLED');
    return appointment;
  }

  private syncCalendarStatus(appointment: any, status: string) {
    return this.calendars.updateOne({
      staff_id: appointment.staff.staff_id,
      date_key: appointment.time_slot.start_time.toISOString().slice(0, 10),
      'slots.appointment_code': appointment.booking_code
    }, { $set: { 'slots.$.status': status } });
  }

  async addReview(input: any, userId: string) {
    const appointment = await this.appointments.findOne({
      _id: input.appointment_id, 'customer.user_id': userId, status: 'COMPLETED'
    });
    if (!appointment) throw new BadRequestException('Chỉ có thể đánh giá lịch đã hoàn thành');
    if (await this.reviews.exists({ appointment_id: appointment._id })) {
      throw new ConflictException('Lịch hẹn này đã được đánh giá');
    }
    return this.reviews.create({
      appointment_id: appointment._id, customer_id: userId,
      staff_id: appointment.staff.staff_id, rating: input.rating,
      comment: String(input.comment || '').slice(0, 1000), images: []
    });
  }

  listReviews(staffId?: string) {
    return this.reviews.find(staffId ? { staff_id: staffId } : {}).sort({ created_at: -1 });
  }

  async report() {
    const completed = { status: 'COMPLETED' };
    const [revenue, topServices, staffPerformance, totals, statusCounts] = await Promise.all([
      this.appointments.aggregate([
        { $match: completed },
        { $group: { _id: '$branch_id', revenue: { $sum: '$total_amount' }, appointments: { $sum: 1 } } },
        { $lookup: { from: 'branches', localField: '_id', foreignField: '_id', as: 'branch' } },
        { $set: { branch_name: { $first: '$branch.name' } } },
        { $project: { branch: 0 } }, { $sort: { revenue: -1 } }
      ]),
      this.appointments.aggregate([
        { $match: completed }, { $unwind: '$services_booked' },
        { $group: { _id: '$services_booked.service_id', name: { $first: '$services_booked.name' }, bookings: { $sum: 1 }, revenue: { $sum: '$services_booked.price' } } },
        { $sort: { bookings: -1 } }, { $limit: 5 }
      ]),
      this.reviews.aggregate([
        { $group: { _id: '$staff_id', average_rating: { $avg: '$rating' }, review_count: { $sum: 1 } } },
        { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'staff' } },
        { $set: { staff_name: { $first: '$staff.name' } } },
        { $project: { staff: 0 } }, { $sort: { average_rating: -1 } }
      ]),
      this.appointments.aggregate([
        { $match: completed },
        { $group: { _id: null, revenue: { $sum: '$total_amount' }, appointments: { $sum: 1 } } }
      ]),
      this.appointments.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }])
    ]);
    return {
      totals: totals[0] || { revenue: 0, appointments: 0 },
      status_counts: statusCounts,
      revenue_by_branch: revenue,
      top_services: topServices,
      staff_performance: staffPerformance
    };
  }

  listAdminUsers() { return this.users.find().select('-password_hash').sort({ role: 1, name: 1 }); }

  async createBranch(input: any) {
    const branch = await this.branches.create({ ...input, status: input.status || 'ACTIVE' });
    await this.redis.invalidateCatalog();
    return branch;
  }

  async updateBranch(id: string, input: any) {
    const branch = await this.branches.findByIdAndUpdate(id, { $set: input }, { new: true, runValidators: true });
    if (!branch) throw new NotFoundException('Không tìm thấy chi nhánh');
    await this.redis.invalidateCatalog();
    return branch;
  }

  archiveBranch(id: string) { return this.updateBranch(id, { status: 'INACTIVE' }); }

  async createService(input: any) {
    const service = await this.services.create({ ...input, status: input.status || 'ACTIVE' });
    await this.redis.invalidateCatalog();
    return service;
  }

  async updateService(id: string, input: any) {
    const service = await this.services.findByIdAndUpdate(id, { $set: input }, { new: true, runValidators: true });
    if (!service) throw new NotFoundException('Không tìm thấy dịch vụ');
    await this.redis.invalidateCatalog();
    return service;
  }

  archiveService(id: string) { return this.updateService(id, { status: 'INACTIVE' }); }

  async createStaff(input: any) {
    if (await this.users.exists({ phone: input.phone })) throw new ConflictException('Số điện thoại đã tồn tại');
    if (!(await this.branches.exists({ _id: input.branch_id }))) throw new BadRequestException('Chi nhánh không tồn tại');
    const user = await this.users.create({
      name: input.name, phone: input.phone,
      password_hash: await bcrypt.hash(input.password, 12),
      role: 'STAFF', specialty: input.specialty,
      branch_id: input.branch_id, status: 'ACTIVE'
    });
    return this.publicUser(user);
  }

  async updateStaff(id: string, input: any) {
    const update: any = { ...input };
    if (input.phone && await this.users.exists({ phone: input.phone, _id: { $ne: id } })) {
      throw new ConflictException('Số điện thoại đã tồn tại');
    }
    if (input.branch_id && !(await this.branches.exists({ _id: input.branch_id, status: 'ACTIVE' }))) {
      throw new BadRequestException('Chi nhánh không tồn tại hoặc đã ngừng hoạt động');
    }
    if (input.password) update.password_hash = await bcrypt.hash(input.password, 12);
    delete update.password;
    const user = await this.users.findOneAndUpdate(
      { _id: id, role: 'STAFF' }, { $set: update }, { new: true, runValidators: true }
    );
    if (!user) throw new NotFoundException('Không tìm thấy nhân viên');
    return this.publicUser(user);
  }

  archiveStaff(id: string) { return this.updateStaff(id, { status: 'INACTIVE' }); }

  async updateUserStatus(id: string, status: string) {
    const user = await this.users.findByIdAndUpdate(id, { $set: { status } }, { new: true });
    if (!user) throw new NotFoundException('Không tìm thấy tài khoản');
    return this.publicUser(user);
  }
}
