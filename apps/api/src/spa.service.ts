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
    @InjectModel('Category') private categories: Model<any>,
    private redis: RedisService,
    @InjectModel('AdminAudit') private audits: Model<any>
  ) {}

  private auditValue(value: any) {
    if (!value) return null;
    const plain = value.toObject ? value.toObject() : JSON.parse(JSON.stringify(value));
    const scrub = (item: any): any => {
      if (Array.isArray(item)) return item.map(scrub);
      if (item && typeof item === 'object') {
        const result: any = {};
        for (const [key, child] of Object.entries(item)) if (key !== 'password_hash') result[key] = scrub(child);
        return result;
      }
      return item;
    };
    return scrub(plain);
  }

  private writeAudit(actor: any, action: string, entityType: string, entityId: any, before: any, after: any) {
    if (!actor) return Promise.resolve();
    return this.audits.create({
      actor: { user_id: actor.sub, name: actor.name, role: actor.role }, action,
      entity_type: entityType, entity_id: entityId,
      before: this.auditValue(before), after: this.auditValue(after)
    });
  }

  listAudit(entityType?: string, action?: string, limit = 100) {
    const filter: any = {};
    if (entityType) filter.entity_type = entityType;
    if (action) filter.action = action;
    return this.audits.find(filter).sort({ created_at: -1 }).limit(Math.min(Math.max(limit || 100, 1), 200)).lean();
  }

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

  async getAvailability(branchId: string, staffId: string, serviceIds: string[], date: string) {
    if (![branchId, staffId, ...serviceIds].every(id => Types.ObjectId.isValid(id)) || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
      throw new BadRequestException('Thông tin tra cứu khung giờ không hợp lệ');
    }
    const [branch, staff, services] = await Promise.all([
      this.branches.findOne({ _id: branchId, status: 'ACTIVE' }),
      this.users.findOne({ _id: staffId, role: 'STAFF', branch_id: branchId, status: 'ACTIVE' }),
      this.services.find({ _id: { $in: serviceIds }, branch_ids: branchId, status: 'ACTIVE' })
    ]);
    if (!branch || !staff || !serviceIds.length || services.length !== new Set(serviceIds).size) {
      throw new BadRequestException('Chi nhánh, chuyên viên hoặc dịch vụ không hợp lệ');
    }
    const duration = services.reduce((sum, service) => sum + service.duration_minutes, 0);
    const window = this.staffWorkWindow(staff, branch, date);
    if (!window) return { date, duration_minutes: duration, slots: [] };
    const [appointments, holds] = await Promise.all([
      this.appointments.find({
        'staff.staff_id': staff._id, status: { $in: ACTIVE_APPOINTMENT_STATUSES },
        'time_slot.start_time': { $lt: window.close }, 'time_slot.end_time': { $gt: window.open }
      }).select('time_slot').lean(),
      this.redis.listActiveHolds(staffId, date)
    ]);
    const busy = [
      ...appointments.map(item => ({ start: new Date(item.time_slot.start_time), end: new Date(item.time_slot.end_time) })),
      ...holds.map(item => ({ start: new Date(item.startTime), end: new Date(item.endTime) }))
    ];
    const slots: Array<{ start_time: string; end_time: string; label: string }> = [];
    for (let start = new Date(window.open); start.getTime() + duration * 60_000 <= window.close.getTime(); start = new Date(start.getTime() + 30 * 60_000)) {
      const end = new Date(start.getTime() + duration * 60_000);
      if (start <= new Date() || (window.breakStart && start < window.breakEnd! && end > window.breakStart)) continue;
      if (busy.some(item => item.start < end && item.end > start)) continue;
      slots.push({ start_time: start.toISOString(), end_time: end.toISOString(), label: this.vnTime(start) });
    }
    return { date, duration_minutes: duration, slots };
  }

  private staffWorkWindow(staff: any, branch: any, date: string) {
    const day = new Date(`${date}T12:00:00+07:00`).getUTCDay();
    const workingDays = staff.working_days?.length ? staff.working_days : [1, 2, 3, 4, 5, 6];
    if (!workingDays.includes(day) || staff.days_off?.includes(date)) return null;
    const openText = staff.working_hours?.open || branch.opening_hours.open;
    const closeText = staff.working_hours?.close || branch.opening_hours.close;
    const open = new Date(`${date}T${openText}:00+07:00`);
    const close = new Date(`${date}T${closeText}:00+07:00`);
    const branchOpen = new Date(`${date}T${branch.opening_hours.open}:00+07:00`);
    const branchClose = new Date(`${date}T${branch.opening_hours.close}:00+07:00`);
    const effectiveOpen = open > branchOpen ? open : branchOpen;
    const effectiveClose = close < branchClose ? close : branchClose;
    const breakStart = staff.break_hours?.start ? new Date(`${date}T${staff.break_hours.start}:00+07:00`) : null;
    const breakEnd = staff.break_hours?.end ? new Date(`${date}T${staff.break_hours.end}:00+07:00`) : null;
    return { open: effectiveOpen, close: effectiveClose, breakStart, breakEnd };
  }

  private vnTime(date: Date) {
    return new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Ho_Chi_Minh' }).format(date);
  }

  private assertBookableTime(staff: any, branch: any, start: Date, end: Date) {
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(start);
    const window = this.staffWorkWindow(staff, branch, date);
    if (!window || start < window.open || end > window.close) throw new BadRequestException('Khung giờ nằm ngoài ca làm của chuyên viên');
    if (window.breakStart && start < window.breakEnd! && end > window.breakStart) throw new BadRequestException('Khung giờ trùng thời gian nghỉ của chuyên viên');
  }

  async holdSlot(input: any, userId: string, options: { excludeAppointmentId?: string; appointmentId?: string } = {}) {
    const [branch, staff, services] = await Promise.all([
      this.branches.findOne({ _id: input.branch_id, status: 'ACTIVE' }),
      this.users.findOne({ _id: input.staff_id, role: 'STAFF', branch_id: input.branch_id, status: 'ACTIVE' }),
      this.services.find({ _id: { $in: input.service_ids }, branch_ids: input.branch_id, status: 'ACTIVE' })
    ]);
    if (!branch || !staff || services.length !== new Set(input.service_ids).size) {
      throw new BadRequestException('Chuyên viên hoặc dịch vụ không hợp lệ');
    }
    const start = new Date(input.start_time);
    if (Number.isNaN(start.getTime()) || start <= new Date()) {
      throw new BadRequestException('Thời gian hẹn phải ở tương lai');
    }
    const duration = services.reduce((sum, service) => sum + service.duration_minutes, 0);
    const end = new Date(start.getTime() + duration * 60_000);
    this.assertBookableTime(staff, branch, start, end);
    const conflict = await this.appointments.exists({
      ...(options.excludeAppointmentId ? { _id: { $ne: new Types.ObjectId(options.excludeAppointmentId) } } : {}),
      'staff.staff_id': staff._id,
      status: { $in: ACTIVE_APPOINTMENT_STATUSES },
      'time_slot.start_time': { $lt: end },
      'time_slot.end_time': { $gt: start }
    });
    if (conflict) throw new ConflictException('Khung giờ này chuyên viên đã bận');

    const hold: SlotHold = {
      token: crypto.randomUUID(), userId, staffId: input.staff_id,
      branchId: input.branch_id, serviceIds: [...input.service_ids].sort(),
      startTime: start.toISOString(), endTime: end.toISOString(), appointmentId: options.appointmentId
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

  async holdRescheduleSlot(appointmentId: string, input: any, userId: string) {
    const appointment = await this.getReschedulableAppointment(appointmentId, userId);
    if (appointment.branch_id.toString() !== input.branch_id) throw new BadRequestException('Không thể đổi sang chi nhánh khác');
    const currentServices = appointment.services_booked.map((item: any) => item.service_id.toString()).sort();
    if (JSON.stringify(currentServices) !== JSON.stringify([...input.service_ids].sort())) {
      throw new BadRequestException('Không thể thay đổi dịch vụ trong thao tác đổi lịch');
    }
    return this.holdSlot(input, userId, { excludeAppointmentId: appointmentId, appointmentId });
  }

  private async getReschedulableAppointment(id: string, userId: string) {
    const appointment = await this.appointments.findOne({ _id: id, 'customer.user_id': userId });
    if (!appointment) throw new NotFoundException('Không tìm thấy lịch hẹn');
    if (appointment.status !== 'CONFIRMED') throw new ConflictException('Chỉ có thể đổi lịch đang chờ phục vụ');
    if (appointment.time_slot.start_time.getTime() - Date.now() < 2 * 60 * 60_000) {
      throw new ConflictException('Chỉ có thể đổi lịch trước giờ hẹn ít nhất 2 tiếng');
    }
    return appointment;
  }

  async rescheduleAppointment(id: string, input: any, userId: string, reason?: string) {
    const appointment = await this.getReschedulableAppointment(id, userId);
    const hold = await this.redis.getHold(input.hold_token);
    if (!hold || hold.userId !== userId || hold.appointmentId !== id) {
      throw new ConflictException('Phiên giữ giờ đổi lịch không tồn tại hoặc đã hết hạn');
    }
    const same = hold.staffId === input.staff_id && hold.branchId === input.branch_id
      && hold.startTime === new Date(input.start_time).toISOString()
      && JSON.stringify(hold.serviceIds) === JSON.stringify([...input.service_ids].sort());
    if (!same) throw new BadRequestException('Thông tin đổi lịch không khớp với phiên giữ chỗ');
    if (appointment.branch_id.toString() !== input.branch_id) throw new BadRequestException('Không thể đổi sang chi nhánh khác');
    const currentServices = appointment.services_booked.map((item: any) => item.service_id.toString()).sort();
    if (JSON.stringify(currentServices) !== JSON.stringify([...input.service_ids].sort())) {
      throw new BadRequestException('Không thể thay đổi dịch vụ trong thao tác đổi lịch');
    }
    const staff = await this.users.findOne({ _id: hold.staffId, role: 'STAFF', branch_id: hold.branchId, status: 'ACTIVE' });
    if (!staff) throw new BadRequestException('Chuyên viên mới không còn khả dụng');

    const newStart = new Date(hold.startTime);
    const newEnd = new Date(hold.endTime);
    const oldStart = appointment.time_slot.start_time;
    const oldStaffId = appointment.staff.staff_id;
    const oldDateKey = oldStart.toISOString().slice(0, 10);
    const newDateKey = newStart.toISOString().slice(0, 10);
    const provisionalCode = `${appointment.booking_code}:MOVE:${hold.token.slice(0, 8)}`;
    const targetFilter = {
      staff_id: staff._id, date_key: newDateKey,
      slots: { $not: { $elemMatch: {
        appointment_code: { $ne: appointment.booking_code },
        status: { $in: ACTIVE_APPOINTMENT_STATUSES }, start_time: { $lt: newEnd }, end_time: { $gt: newStart }
      } } }
    };
    try {
      await this.calendars.findOneAndUpdate(targetFilter, {
        $setOnInsert: { staff_id: staff._id, date_key: newDateKey },
        $push: { slots: { appointment_code: provisionalCode, start_time: newStart, end_time: newEnd, status: 'CONFIRMED' } }
      }, { upsert: true, new: true });
    } catch (error: any) {
      if (error.code === 11000) throw new ConflictException('Khung giờ mới vừa được người khác đặt');
      throw error;
    }

    const now = new Date();
    const updated = await this.appointments.findOneAndUpdate(
      { _id: appointment._id, 'customer.user_id': userId, status: 'CONFIRMED', 'time_slot.start_time': oldStart },
      {
        $set: { staff: { staff_id: staff._id, name: staff.name }, time_slot: { start_time: newStart, end_time: newEnd } },
        $push: { reschedule_history: {
          at: now, actor_id: new Types.ObjectId(userId), reason: String(reason || '').trim().slice(0, 500),
          from: { staff_id: oldStaffId, staff_name: appointment.staff.name, start_time: oldStart, end_time: appointment.time_slot.end_time },
          to: { staff_id: staff._id, staff_name: staff.name, start_time: newStart, end_time: newEnd }
        } }
      },
      { new: true }
    );
    if (!updated) {
      await this.calendars.updateOne({ staff_id: staff._id, date_key: newDateKey }, { $pull: { slots: { appointment_code: provisionalCode } } });
      throw new ConflictException('Lịch hẹn vừa được cập nhật ở nơi khác, vui lòng thử lại');
    }
    await this.calendars.updateOne({ staff_id: oldStaffId, date_key: oldDateKey }, { $pull: { slots: { appointment_code: appointment.booking_code } } });
    await this.calendars.updateOne(
      { staff_id: staff._id, date_key: newDateKey, 'slots.appointment_code': provisionalCode },
      { $set: { 'slots.$.appointment_code': appointment.booking_code } }
    );
    await this.redis.releaseHold(hold);
    return updated;
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
        note: String(input.note || '').slice(0, 500), status: 'CONFIRMED',
        status_history: [{
          from: '', to: 'CONFIRMED', at: new Date(), actor_id: customer._id,
          actor_role: 'CUSTOMER', actor_name: customer.name, reason: 'Khách hàng đặt lịch'
        }]
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
    return this.appointments.find(filter).sort({ 'time_slot.start_time': user.role === 'STAFF' ? 1 : -1 }).limit(200);
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

  async setStatus(id: string, status: string, user: any, reason?: string) {
    const filter: any = { _id: id };
    if (user.role === 'STAFF') filter['staff.staff_id'] = user.sub;
    const current = await this.appointments.findOne(filter);
    if (!current) throw new NotFoundException('Không tìm thấy lịch hẹn');
    if (user.role === 'STAFF' && status === 'CANCELLED') {
      throw new ForbiddenException('Nhân viên không được tự hủy lịch hẹn');
    }
    if (!canTransition(current.status, status)) {
      throw new ConflictException(`Không thể chuyển từ ${current.status} sang ${status}`);
    }
    const normalizedReason = String(reason || '').trim().slice(0, 500);
    if ((status === 'CANCELLED' || status === 'NO_SHOW') && !normalizedReason) {
      throw new BadRequestException('Vui lòng nhập lý do cập nhật trạng thái');
    }

    const now = new Date();
    if (user.role === 'STAFF' || user.role === 'ADMIN') {
      const startMs = current.time_slot.start_time.getTime();
      if (status === 'CHECKED_IN' && (now.getTime() < startMs - 30 * 60_000 || now.getTime() > startMs + 60 * 60_000)) {
        throw new ConflictException('Chỉ có thể xác nhận khách đã đến từ 30 phút trước đến 60 phút sau giờ hẹn');
      }
      if (status === 'NO_SHOW' && now.getTime() < startMs + 15 * 60_000) {
        throw new ConflictException('Chỉ có thể đánh dấu khách vắng sau giờ hẹn 15 phút');
      }
      if (status === 'IN_PROGRESS' && !current.checked_in_at) {
        throw new ConflictException('Cần xác nhận khách đã đến trước khi bắt đầu phục vụ');
      }
      if (status === 'IN_PROGRESS' && now.getTime() < startMs - 30 * 60_000) {
        throw new ConflictException('Chưa đến thời gian bắt đầu phục vụ lịch hẹn');
      }
      if (status === 'COMPLETED' && !current.started_at) {
        throw new ConflictException('Lịch hẹn chưa được bắt đầu');
      }
      if (status === 'COMPLETED' && now.getTime() < startMs) {
        throw new ConflictException('Không thể hoàn thành lịch hẹn trước giờ hẹn');
      }
    }

    const timestampField: Record<string, string> = {
      CHECKED_IN: 'checked_in_at', IN_PROGRESS: 'started_at', COMPLETED: 'completed_at'
    };
    const set: Record<string, unknown> = { status };
    if (timestampField[status]) set[timestampField[status]] = now;
    const updated = await this.appointments.findOneAndUpdate(
      { ...filter, status: current.status },
      {
        $set: set,
        $push: { status_history: {
          from: current.status, to: status, at: now, actor_id: new Types.ObjectId(user.sub),
          actor_role: user.role, actor_name: user.name, reason: normalizedReason
        } }
      },
      { new: true, runValidators: true }
    );
    if (!updated) throw new ConflictException('Lịch hẹn vừa được cập nhật ở nơi khác, vui lòng tải lại');
    await this.syncCalendarStatus(updated, status);
    if (user.role === 'ADMIN') await this.writeAudit(user, 'STATUS_CHANGE', 'APPOINTMENT', updated._id, current, updated);
    return updated;
  }

  async cancelAppointment(id: string, userId: string) {
    const appointment = await this.appointments.findOne({ _id: id, 'customer.user_id': userId });
    if (!appointment) throw new NotFoundException('Không tìm thấy lịch hẹn');
    if (!canTransition(appointment.status, 'CANCELLED')) {
      throw new ConflictException('Lịch hẹn này không thể hủy');
    }
    const now = new Date();
    const updated = await this.appointments.findOneAndUpdate(
      { _id: id, 'customer.user_id': userId, status: appointment.status },
      {
        $set: { status: 'CANCELLED' },
        $push: { status_history: {
          from: appointment.status, to: 'CANCELLED', at: now, actor_id: new Types.ObjectId(userId),
          actor_role: 'CUSTOMER', actor_name: appointment.customer.name, reason: 'Khách hàng tự hủy'
        } }
      },
      { new: true }
    );
    if (!updated) throw new ConflictException('Lịch hẹn vừa được cập nhật ở nơi khác, vui lòng tải lại');
    await this.syncCalendarStatus(updated, 'CANCELLED');
    return updated;
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
  listAdminBranches() { return this.branches.find().sort({ status: 1, name: 1 }).lean(); }
  listAdminServices() { return this.services.find().sort({ status: 1, category: 1, name: 1 }).lean(); }

  async createBranch(input: any, actor?: any) {
    const branch = await this.branches.create({ ...input, status: input.status || 'ACTIVE' });
    await this.writeAudit(actor, 'CREATE', 'BRANCH', branch._id, null, branch);
    await this.redis.invalidateCatalog();
    return branch;
  }

  async updateBranch(id: string, input: any, actor?: any, action = 'UPDATE') {
    const before = await this.branches.findById(id).lean();
    const branch = await this.branches.findByIdAndUpdate(id, { $set: input }, { new: true, runValidators: true });
    if (!branch) throw new NotFoundException('Không tìm thấy chi nhánh');
    await this.writeAudit(actor, action, 'BRANCH', branch._id, before, branch);
    await this.redis.invalidateCatalog();
    return branch;
  }

  archiveBranch(id: string, actor?: any) { return this.updateBranch(id, { status: 'INACTIVE' }, actor, 'ARCHIVE'); }

  async createService(input: any, actor?: any) {
    const service = await this.services.create({ ...input, status: input.status || 'ACTIVE' });
    await this.writeAudit(actor, 'CREATE', 'SERVICE', service._id, null, service);
    await this.redis.invalidateCatalog();
    return service;
  }

  async updateService(id: string, input: any, actor?: any, action = 'UPDATE') {
    const before = await this.services.findById(id).lean();
    const service = await this.services.findByIdAndUpdate(id, { $set: input }, { new: true, runValidators: true });
    if (!service) throw new NotFoundException('Không tìm thấy dịch vụ');
    await this.writeAudit(actor, action, 'SERVICE', service._id, before, service);
    await this.redis.invalidateCatalog();
    return service;
  }

  archiveService(id: string, actor?: any) { return this.updateService(id, { status: 'INACTIVE' }, actor, 'ARCHIVE'); }

  async createStaff(input: any, actor?: any) {
    if (await this.users.exists({ phone: input.phone })) throw new ConflictException('Số điện thoại đã tồn tại');
    if (!(await this.branches.exists({ _id: input.branch_id }))) throw new BadRequestException('Chi nhánh không tồn tại');
    const user = await this.users.create({
      name: input.name, phone: input.phone,
      password_hash: await bcrypt.hash(input.password, 12),
      role: 'STAFF', specialty: input.specialty,
      branch_id: input.branch_id, working_days: input.working_days,
      working_hours: input.working_hours, break_hours: input.break_hours, days_off: input.days_off,
      status: 'ACTIVE'
    });
    await this.writeAudit(actor, 'CREATE', 'STAFF', user._id, null, user);
    return this.publicUser(user);
  }

  async updateStaff(id: string, input: any, actor?: any, action = 'UPDATE') {
    const before = await this.users.findOne({ _id: id, role: 'STAFF' }).lean();
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
    await this.writeAudit(actor, action, 'STAFF', user._id, before, user);
    return this.publicUser(user);
  }

  archiveStaff(id: string, actor?: any) { return this.updateStaff(id, { status: 'INACTIVE' }, actor, 'ARCHIVE'); }

  async updateUserStatus(id: string, status: string, actor?: any) {
    const before = await this.users.findById(id).lean();
    const user = await this.users.findByIdAndUpdate(id, { $set: { status } }, { new: true });
    if (!user) throw new NotFoundException('Không tìm thấy tài khoản');
    await this.writeAudit(actor, 'STATUS_CHANGE', 'USER', user._id, before, user);
    return this.publicUser(user);
  }

  async listCategories(includeAll = false) {
    const query = includeAll ? {} : { status: 'ACTIVE' };
    const list = await this.categories.find(query).sort({ status: 1, name: 1 }).lean();
    if (list.length === 0 && !includeAll) {
      const defaults = [
        { name: 'Tóc & Tạo kiểu', description: 'Cắt, uốn, duỗi, tạo mẫu tóc', status: 'ACTIVE' },
        { name: 'Gội đầu dưỡng sinh', description: 'Gội thảo dược, massage thư giãn da đầu', status: 'ACTIVE' },
        { name: 'Chăm sóc da & Facial', description: 'Chăm sóc da mặt chuyên sâu, cấp ẩm, thải độc', status: 'ACTIVE' },
        { name: 'Spa & Massage trị liệu', description: 'Massage body đá nóng, trị liệu cổ vai gáy', status: 'ACTIVE' },
        { name: 'Nail & Chăm sóc móng', description: 'Làm móng, sơn gel, vẽ nghệ thuật', status: 'ACTIVE' },
        { name: 'Phun xăm thẩm mỹ', description: 'Điêu khắc chân mày, phun môi collagen', status: 'ACTIVE' },
        { name: 'Trang điểm (Makeup)', description: 'Makeup dự tiệc, cô dâu, kỷ yếu', status: 'ACTIVE' },
        { name: 'Triệt lông & Tẩy tế bào chết', description: 'Triệt lông công nghệ diode laser, thanh tẩy body', status: 'ACTIVE' },
        { name: 'Combo thư giãn toàn diện', description: 'Gói chăm sóc sắc đẹp và thư giãn trọn gói', status: 'ACTIVE' }
      ];
      await this.categories.insertMany(defaults);
      return this.categories.find(query).sort({ status: 1, name: 1 }).lean();
    }
    return list;
  }

  async createCategory(input: any, actor?: any) {
    if (await this.categories.exists({ name: input.name })) {
      throw new ConflictException('Tên danh mục đã tồn tại');
    }
    const cat = await this.categories.create({ ...input, status: input.status || 'ACTIVE' });
    await this.writeAudit(actor, 'CREATE', 'CATEGORY', cat._id, null, cat);
    await this.redis.invalidateCatalog();
    return cat;
  }

  async updateCategory(id: string, input: any, actor?: any, action = 'UPDATE') {
    if (input.name && await this.categories.exists({ name: input.name, _id: { $ne: id } })) {
      throw new ConflictException('Tên danh mục đã tồn tại');
    }
    const before = await this.categories.findById(id).lean();
    const cat = await this.categories.findByIdAndUpdate(id, { $set: input }, { new: true, runValidators: true });
    if (!cat) throw new NotFoundException('Không tìm thấy danh mục');
    await this.writeAudit(actor, action, 'CATEGORY', cat._id, before, cat);
    await this.redis.invalidateCatalog();
    return cat;
  }

  archiveCategory(id: string, actor?: any) {
    return this.updateCategory(id, { status: 'INACTIVE' }, actor, 'ARCHIVE');
  }
}
