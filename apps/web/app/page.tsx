'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';

type Item = {
  _id: string; name: string; description?: string; category?: string; price?: number;
  duration_minutes?: number; is_estimated?: boolean; branch_ids?: string[]; branch_id?: string; specialty?: string;
  role?: string; status?: string; phone?: string; address?: string; distance_meters?: number;
  location?: { coordinates: number[] }; opening_hours?: { open: string; close: string };
  working_days?: number[]; working_hours?: { open: string; close: string };
  break_hours?: { start: string; end: string }; days_off?: string[];
};

type AvailableSlot = { start_time: string; end_time: string; label: string };
type AuditEntry = { _id: string; created_at: string; action: string; entity_type: string; entity_id: string; actor: { name: string; role: string }; before?: any; after?: any };

type Appointment = {
  _id: string; booking_code: string; branch_id: string; status: string; total_amount: number; note?: string;
  checked_in_at?: string; started_at?: string; completed_at?: string;
  customer: { name: string; phone: string }; staff: { staff_id: string; name: string };
  time_slot: { start_time: string; end_time: string };
  services_booked: Array<{ service_id: string; name: string; price: number; duration: number }>;
  reschedule_history?: Array<{ at: string; reason?: string; from: { staff_name: string; start_time: string }; to: { staff_name: string; start_time: string } }>;
};

const cash = (value: number) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(value);
const dateTime = (value: string) => new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const formatDuration = (minutes = 0, isEstimated = false) => (isEstimated || minutes >= 90) ? `~ ${minutes} phút (ước tính)` : `${minutes} phút`;
const roleLabel = (role = '') => ({ CUSTOMER: 'Khách hàng', STAFF: 'Nhân viên', ADMIN: 'Quản trị viên' }[role] || role);
const statusLabel = (status: string) => ({ CONFIRMED: 'Đã xác nhận', CHECKED_IN: 'Khách đã đến', IN_PROGRESS: 'Đang phục vụ', COMPLETED: 'Hoàn thành', CANCELLED: 'Đã hủy', NO_SHOW: 'Khách vắng' }[status] || status);
const canCheckInNow = (appointment: Appointment) => { const start = new Date(appointment.time_slot.start_time).getTime(); const now = Date.now(); return now >= start - 30 * 60_000 && now <= start + 60 * 60_000; };
const canStartNow = (appointment: Appointment) => Date.now() >= new Date(appointment.time_slot.start_time).getTime() - 30 * 60_000;
const canCompleteNow = (appointment: Appointment) => Date.now() >= new Date(appointment.time_slot.start_time).getTime();

const DEFAULT_CATEGORIES = [
  'Tóc & Tạo kiểu',
  'Gội đầu dưỡng sinh',
  'Chăm sóc da & Facial',
  'Spa & Massage trị liệu',
  'Nail & Chăm sóc móng',
  'Phun xăm thẩm mỹ',
  'Trang điểm (Makeup)',
  'Triệt lông & Tẩy tế bào chết',
  'Combo thư giãn toàn diện'
];

const DEFAULT_SPECIALTIES = [
  'Hair Stylist (Tạo mẫu tóc)',
  'Kỹ thuật viên Tóc (Cắt, Uốn, Nhuộm)',
  'Kỹ thuật viên Gội dưỡng sinh',
  'Chuyên viên Chăm sóc da (Skin care)',
  'Kỹ thuật viên Spa & Massage trị liệu',
  'Kỹ thuật viên Nail & Chăm sóc móng',
  'Chuyên viên Trang điểm (Makeup Artist)'
];
const WEEKDAYS = [{ value: 1, label: 'T2' }, { value: 2, label: 'T3' }, { value: 3, label: 'T4' }, { value: 4, label: 'T5' }, { value: 5, label: 'T6' }, { value: 6, label: 'T7' }, { value: 0, label: 'CN' }];

async function api(path: string, options: RequestInit = {}) {
  const token = localStorage.getItem('token');
  const response = await fetch('/api' + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers }
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && path !== '/auth/login') {
    localStorage.removeItem('token'); localStorage.removeItem('user');
    window.dispatchEvent(new Event('auth-expired'));
    throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
  }
  if (!response.ok) throw new Error(Array.isArray(data.message) ? data.message.join(', ') : data.message || 'Có lỗi xảy ra');
  return data;
}

function maxValue(items: any[], key: string) {
  return Math.max(1, ...items.map(item => Number(item[key]) || 0));
}

export default function Home() {
  const [branches, setBranches] = useState<Item[]>([]);
  const [services, setServices] = useState<Item[]>([]);
  const [categories, setCategories] = useState<Item[]>([]);
  const [staff, setStaff] = useState<Item[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [users, setUsers] = useState<Item[]>([]);
  const [report, setReport] = useState<any>(null);
  const [user, setUser] = useState<any>(null);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [branch, setBranch] = useState('');
  const [staffId, setStaffId] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('09:00');
  const [note, setNote] = useState('');
  const [hold, setHold] = useState<any>(null);
  const [seconds, setSeconds] = useState(0);
  const [scheduleView, setScheduleView] = useState<'ALL' | 'TODAY' | 'WEEK'>('ALL');
  const [message, setMessage] = useState('');
  const [branchAddress, setBranchAddress] = useState('');
  const [branchLng, setBranchLng] = useState('106.6917');
  const [branchLat, setBranchLat] = useState('10.7719');
  const [geoStatus, setGeoStatus] = useState('');
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [editingModal, setEditingModal] = useState<{ kind: 'branches' | 'services' | 'staff' | 'categories'; item: Item } | null>(null);
  const [updatingAppointment, setUpdatingAppointment] = useState('');
  const [availableSlots, setAvailableSlots] = useState<AvailableSlot[]>([]);
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [reschedule, setReschedule] = useState<{ appointment: Appointment; staff: Item[]; staffId: string; date: string; time: string; slots: AvailableSlot[]; hold: any; reason: string; loading: boolean } | null>(null);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);

  const categoryOptions = useMemo(() => {
    if (categories.length > 0) {
      const activeCats = categories.filter(c => c.status !== 'INACTIVE').map(c => c.name);
      if (activeCats.length > 0) return activeCats;
    }
    const set = new Set<string>();
    services.forEach(s => { if (s.category) set.add(s.category); });
    DEFAULT_CATEGORIES.forEach(c => set.add(c));
    return Array.from(set);
  }, [categories, services]);

  const specialtyOptions = useMemo(() => {
    const set = new Set<string>();
    users.forEach(u => { if (u.specialty) set.add(u.specialty); });
    DEFAULT_SPECIALTIES.forEach(s => set.add(s));
    return Array.from(set);
  }, [users]);

  const hotServices = useMemo(() => {
    if (!services.length) return [];
    const topIds = (report?.top_services || []).map((t: any) => String(t._id));
    const sorted = [...services].sort((a, b) => {
      const aIndex = topIds.indexOf(String(a._id));
      const bIndex = topIds.indexOf(String(b._id));
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
      return 0;
    });
    return sorted.slice(0, 4);
  }, [services, report]);

  function handleSelectHotService(service: Item) {
    if (!user) {
      const el = document.getElementById('login');
      el?.scrollIntoView({ behavior: 'smooth' });
      setMessage(`Đăng nhập để đặt lịch dịch vụ “${service.name}”.`);
      return;
    }
    if (user.role === 'CUSTOMER') {
      if (service.branch_ids && service.branch_ids.length > 0) {
        if (!branch || !service.branch_ids.includes(branch)) {
          setBranch(service.branch_ids[0]);
        }
      }
      setChosen(prev => Array.from(new Set([...prev, service._id])));
      releaseHold();
      const el = document.getElementById('booking');
      el?.scrollIntoView({ behavior: 'smooth' });
      setMessage(`Đã chọn “${service.name}”. Hãy chọn chuyên viên và giờ hẹn.`);
    } else {
      const el = document.getElementById('workspace');
      el?.scrollIntoView({ behavior: 'smooth' });
      setMessage(`Dịch vụ hot: ${service.name} (${cash(service.price || 0)})`);
    }
  }

  async function geocodeAddress(queryAddress?: string) {
    const target = (queryAddress ?? branchAddress).trim();
    if (!target) {
      setMessage('Vui lòng nhập địa chỉ trước khi xác định vị trí.');
      return null;
    }
    setIsGeocoding(true);
    setGeoStatus('Đang tìm tọa độ từ địa chỉ...');
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(target + ', Việt Nam')}&limit=1`, {
        headers: { 'Accept-Language': 'vi' }
      });
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        const lat = parseFloat(Number(data[0].lat).toFixed(5));
        const lng = parseFloat(Number(data[0].lon).toFixed(5));
        setBranchLat(String(lat));
        setBranchLng(String(lng));
        setGeoStatus(`Đã định vị: ${lat}, ${lng}`);
        setMessage('Đã tự động xác định tọa độ từ địa chỉ.');
        return [lng, lat];
      } else {
        setGeoStatus('Chưa tìm thấy tọa độ chính xác, đã gán tọa độ TP.HCM');
        setMessage('Không tìm thấy tọa độ chính xác cho địa chỉ này, đã áp dụng tọa độ mặc định.');
      }
    } catch {
      setGeoStatus('Không thể kết nối dịch vụ định vị');
      setMessage('Không thể kết nối bản đồ, đã áp dụng tọa độ mặc định.');
    } finally {
      setIsGeocoding(false);
    }
    return null;
  }

  function useCurrentLocationForBranch() {
    if (!navigator.geolocation) return setMessage('Trình duyệt không hỗ trợ định vị.');
    setIsGeocoding(true);
    setGeoStatus('Đang lấy vị trí GPS...');
    navigator.geolocation.getCurrentPosition(
      pos => {
        const lat = parseFloat(pos.coords.latitude.toFixed(5));
        const lng = parseFloat(pos.coords.longitude.toFixed(5));
        setBranchLat(String(lat));
        setBranchLng(String(lng));
        setGeoStatus(`Vị trí hiện tại: ${lat}, ${lng}`);
        setMessage('Đã cập nhật tọa độ từ vị trí hiện tại của bạn.');
        setIsGeocoding(false);
      },
      () => {
        setMessage('Không thể lấy vị trí hiện tại. Hãy cấp quyền truy cập vị trí.');
        setIsGeocoding(false);
        setGeoStatus('');
      }
    );
  }

  async function loadCatalog(path = '/branches') {
    const [branchList, serviceList, categoryList] = await Promise.all([
      api(path),
      api('/services'),
      api('/categories').catch(() => [])
    ]);
    setBranches(branchList);
    setServices(serviceList);
    if (Array.isArray(categoryList) && categoryList.length > 0) {
      setCategories(categoryList);
    }
  }

  useEffect(() => {
    loadCatalog().catch(error => setMessage(error.message));
    setUser(JSON.parse(localStorage.getItem('user') || 'null'));
    const tomorrow = new Date(Date.now() + 86_400_000);
    setDate(tomorrow.toISOString().slice(0, 10));
  }, []);

  useEffect(() => {
    const resetSession = () => {
      setUser(null); setAppointments([]); setReport(null); setHold(null);
      setMessage('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
    };
    window.addEventListener('auth-expired', resetSession);
    return () => window.removeEventListener('auth-expired', resetSession);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    let frame = 0;
    const updatePointer = (event: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        root.style.setProperty('--cursor-x', `${event.clientX}px`);
        root.style.setProperty('--cursor-y', `${event.clientY}px`);
        root.style.setProperty('--parallax-x', `${(event.clientX / window.innerWidth - .5) * 18}px`);
        root.style.setProperty('--parallax-y', `${(event.clientY / window.innerHeight - .5) * 14}px`);
      });
    };
    const updateScroll = () => {
      const progress = document.querySelector<HTMLElement>('.scroll-progress');
      if (progress) {
        const maximum = document.documentElement.scrollHeight - window.innerHeight;
        progress.style.transform = `scaleX(${maximum > 0 ? window.scrollY / maximum : 0})`;
      }
    };
    window.addEventListener('pointermove', updatePointer, { passive: true });
    window.addEventListener('scroll', updateScroll, { passive: true });
    updateScroll();
    return () => { cancelAnimationFrame(frame); window.removeEventListener('pointermove', updatePointer); window.removeEventListener('scroll', updateScroll); };
  }, []);

  useEffect(() => {
    if (!('IntersectionObserver' in window)) return;
    const elements = document.querySelectorAll<HTMLElement>('main > section:not(.hero), .grid article, .metrics article, .report-grid > *, .appointment-list > article, .admin-card, .manage-card');
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => { if (entry.isIntersecting) { entry.target.classList.add('is-visible'); observer.unobserve(entry.target); } });
    }, { threshold: .12, rootMargin: '0px 0px -35px' });
    elements.forEach((element, index) => {
      element.classList.add('reveal-ready');
      element.style.setProperty('--reveal-delay', `${Math.min(index % 4, 3) * 80}ms`);
      observer.observe(element);
    });
    return () => observer.disconnect();
  }, [user, services.length, appointments.length, Boolean(report)]);

  useEffect(() => {
    if (branch) api(`/staff?branch_id=${branch}`).then(setStaff).catch(error => setMessage(error.message));
    else setStaff([]);
  }, [branch]);

  useEffect(() => {
    if (!branch || !staffId || !chosen.length || !date) { setAvailableSlots([]); return; }
    let active = true;
    setLoadingAvailability(true);
    api(`/availability?branch_id=${branch}&staff_id=${staffId}&service_ids=${chosen.join(',')}&date=${date}`)
      .then(result => {
        if (!active) return;
        const slots: AvailableSlot[] = result.slots || [];
        setAvailableSlots(slots);
        setTime(current => slots.some(slot => slot.label === current) ? current : (slots[0]?.label || ''));
      })
      .catch(error => { if (active) { setAvailableSlots([]); setTime(''); setMessage(error.message); } })
      .finally(() => { if (active) setLoadingAvailability(false); });
    return () => { active = false; };
  }, [branch, staffId, chosen, date]);

  useEffect(() => {
    if (!reschedule || reschedule.hold || !reschedule.staffId || !reschedule.date) return;
    let active = true;
    setReschedule(value => value ? { ...value, loading: true } : value);
    const serviceIds = reschedule.appointment.services_booked.map(item => item.service_id).join(',');
    api(`/availability?branch_id=${reschedule.appointment.branch_id}&staff_id=${reschedule.staffId}&service_ids=${serviceIds}&date=${reschedule.date}`)
      .then(result => { if (active) setReschedule(value => value ? { ...value, slots: result.slots || [], time: result.slots?.[0]?.label || '', loading: false } : value); })
      .catch(error => { if (active) { setMessage(error.message); setReschedule(value => value ? { ...value, slots: [], time: '', loading: false } : value); } });
    return () => { active = false; };
  }, [reschedule?.staffId, reschedule?.date, reschedule?.appointment._id, Boolean(reschedule?.hold)]);

  useEffect(() => {
    if (!user) return;
    if (user.role === 'STAFF') setScheduleView('TODAY');
    loadAppointments();
    if (user.role === 'ADMIN') loadAdmin();
  }, [user]);

  useEffect(() => {
    if (!hold) return;
    const update = () => {
      const left = Math.max(0, Math.floor((new Date(hold.expires_at).getTime() - Date.now()) / 1000));
      setSeconds(left);
      if (!left) { setHold(null); setMessage('Thời gian giữ chỗ đã hết. Vui lòng chọn lại.'); }
    };
    update(); const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [hold]);

  const available = services.filter(service => service.branch_ids?.includes(branch));
  const selected = services.filter(service => chosen.includes(service._id));
  const total = useMemo(() => selected.reduce((sum, service) => sum + (service.price || 0), 0), [selected]);
  const payload = {
    branch_id: branch, staff_id: staffId, service_ids: chosen,
    start_time: availableSlots.find(slot => slot.label === time)?.start_time || ''
  };
  const visibleAppointments = useMemo(() => {
    if (scheduleView === 'ALL') return appointments;
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setDate(end.getDate() + (scheduleView === 'TODAY' ? 1 : 7));
    return appointments.filter(item => {
      const value = new Date(item.time_slot.start_time);
      return value >= start && value < end;
    });
  }, [appointments, scheduleView]);

  async function loadAppointments() {
    try { setAppointments(await api('/appointments/mine')); } catch (error: any) { setMessage(error.message); }
  }

  async function loadAdmin() {
    try {
      const [dashboard, accountList, branchList, serviceList, categoryList, auditList] = await Promise.all([
        api('/reports/dashboard'),
        api('/admin/users'),
        api('/admin/branches'),
        api('/admin/services'),
        api('/admin/categories').catch(() => []),
        api('/admin/audit?limit=100').catch(() => [])
      ]);
      setReport(dashboard);
      setUsers(accountList);
      setBranches(branchList);
      setServices(serviceList);
      if (Array.isArray(categoryList)) {
        setCategories(categoryList);
      }
      if (Array.isArray(auditList)) setAuditLog(auditList);
    } catch (error: any) { setMessage(error.message); }
  }

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    try {
      const result = await api('/auth/login', { method: 'POST', body: JSON.stringify({ phone: form.get('phone'), password: form.get('password') }) });
      localStorage.setItem('token', result.token); localStorage.setItem('user', JSON.stringify(result.user));
      setUser(result.user); setMessage(`Xin chào ${result.user.name}`);
    } catch (error: any) { setMessage(error.message); }
  }

  async function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    try {
      const result = await api('/auth/register', { method: 'POST', body: JSON.stringify({ name: form.get('name'), phone: form.get('phone'), password: form.get('password') }) });
      localStorage.setItem('token', result.token); localStorage.setItem('user', JSON.stringify(result.user));
      setUser(result.user); setMessage('Đăng ký thành công. Chào mừng bạn đến với NexaSalon!');
    } catch (error: any) { setMessage(error.message); }
  }

  function logout() {
    localStorage.removeItem('token'); localStorage.removeItem('user');
    setUser(null); setAppointments([]); setReport(null); setHold(null); setMessage('Đã đăng xuất.');
  }

  function findNearest() {
    if (!navigator.geolocation) return setMessage('Trình duyệt không hỗ trợ xác định vị trí.');
    setMessage('Đang tìm chi nhánh gần bạn...');
    navigator.geolocation.getCurrentPosition(
      position => loadCatalog(`/branches?longitude=${position.coords.longitude}&latitude=${position.coords.latitude}`)
        .then(() => setMessage('Đã sắp xếp chi nhánh theo khoảng cách.')).catch(error => setMessage(error.message)),
      () => setMessage('Không thể lấy vị trí. Hãy cho phép truy cập vị trí và thử lại.')
    );
  }

  async function holdSlot(event: FormEvent) {
    event.preventDefault();
    try {
      const result = await api('/slots/hold', { method: 'POST', body: JSON.stringify(payload) });
      setHold(result); setMessage('Khung giờ của bạn đã được giữ trong 15 phút.');
    } catch (error: any) { setMessage(error.message); }
  }

  async function releaseHold() {
    if (!hold) return;
    try { await api(`/slots/${hold.hold_token}`, { method: 'DELETE' }); } catch { /* expired */ }
    setHold(null); setMessage('Đã bỏ khung giờ đang giữ.');
  }

  async function book() {
    try {
      const result = await api('/appointments', { method: 'POST', body: JSON.stringify({ ...payload, hold_token: hold.hold_token, note }) });
      setHold(null); setNote(''); setMessage(`Đặt lịch thành công: ${result.booking_code}`); await loadAppointments();
    } catch (error: any) { setMessage(error.message); }
  }

  async function appointmentAction(id: string, action: 'cancel' | 'CHECKED_IN' | 'IN_PROGRESS' | 'COMPLETED' | 'NO_SHOW') {
    const prompts: Record<string, string> = {
      CHECKED_IN: 'Xác nhận khách hàng đã có mặt tại salon?',
      IN_PROGRESS: 'Bắt đầu phục vụ lịch hẹn này?',
      COMPLETED: 'Xác nhận dịch vụ đã hoàn thành?',
      NO_SHOW: 'Đánh dấu khách hàng vắng mặt?'
    };
    if (action !== 'cancel' && !window.confirm(prompts[action])) return;
    const reason = action === 'NO_SHOW' ? window.prompt('Nhập lý do khách vắng mặt')?.trim() : '';
    if (action === 'NO_SHOW' && !reason) return setMessage('Cần nhập lý do khi đánh dấu khách vắng.');
    setUpdatingAppointment(id);
    try {
      const path = action === 'cancel' ? `/appointments/${id}/cancel` : `/appointments/${id}/status`;
      const body = action === 'cancel' ? undefined : JSON.stringify({ status: action, ...(reason ? { reason } : {}) });
      await api(path, { method: 'PATCH', body });
      setMessage('Đã cập nhật lịch hẹn.'); await loadAppointments(); if (user?.role === 'ADMIN') await loadAdmin();
    } catch (error: any) { setMessage(error.message); }
    finally { setUpdatingAppointment(''); }
  }

  function confirmCancellation(id: string) {
    if (window.confirm('Bạn có chắc chắn muốn hủy lịch hẹn này? Thao tác này không thể hoàn tác.')) appointmentAction(id, 'cancel');
  }

  async function openReschedule(appointment: Appointment) {
    try {
      const workers = await api(`/staff?branch_id=${appointment.branch_id}`);
      const currentDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(appointment.time_slot.start_time));
      setReschedule({ appointment, staff: workers, staffId: appointment.staff.staff_id, date: currentDate, time: '', slots: [], hold: null, reason: '', loading: false });
    } catch (error: any) { setMessage(error.message); }
  }

  async function closeReschedule() {
    if (reschedule?.hold?.hold_token) {
      try { await api(`/slots/${reschedule.hold.hold_token}`, { method: 'DELETE' }); } catch { /* expired */ }
    }
    setReschedule(null);
  }

  async function resetRescheduleHold() {
    if (!reschedule?.hold?.hold_token) return;
    try { await api(`/slots/${reschedule.hold.hold_token}`, { method: 'DELETE' }); } catch { /* expired */ }
    setReschedule(value => value ? { ...value, hold: null } : value);
  }

  async function holdReschedule() {
    if (!reschedule) return;
    const slot = reschedule.slots.find(item => item.label === reschedule.time);
    if (!slot) return;
    const body = { branch_id: reschedule.appointment.branch_id, staff_id: reschedule.staffId, service_ids: reschedule.appointment.services_booked.map(item => item.service_id), start_time: slot.start_time };
    setReschedule(value => value ? { ...value, loading: true } : value);
    try {
      const result = await api(`/appointments/${reschedule.appointment._id}/reschedule/hold`, { method: 'POST', body: JSON.stringify(body) });
      setReschedule(value => value ? { ...value, hold: result, loading: false } : value);
      setMessage('Đã giữ giờ mới trong 15 phút. Lịch cũ vẫn được bảo toàn.');
    } catch (error: any) { setMessage(error.message); setReschedule(value => value ? { ...value, loading: false } : value); }
  }

  async function confirmReschedule() {
    if (!reschedule?.hold) return;
    const slot = reschedule.slots.find(item => item.label === reschedule.time);
    if (!slot) return;
    const body = { branch_id: reschedule.appointment.branch_id, staff_id: reschedule.staffId, service_ids: reschedule.appointment.services_booked.map(item => item.service_id), start_time: slot.start_time, hold_token: reschedule.hold.hold_token, reason: reschedule.reason };
    setReschedule(value => value ? { ...value, loading: true } : value);
    try {
      await api(`/appointments/${reschedule.appointment._id}/reschedule`, { method: 'PATCH', body: JSON.stringify(body) });
      setReschedule(null); await loadAppointments(); setMessage('Đổi lịch thành công. Lịch sử thay đổi đã được lưu.');
    } catch (error: any) { setMessage(error.message); setReschedule(value => value ? { ...value, loading: false } : value); }
  }

  async function review(appointmentId: string) {
    const rating = Number(prompt('Chấm điểm từ 1 đến 5', '5'));
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return setMessage('Điểm đánh giá phải từ 1 đến 5.');
    const comment = prompt('Chia sẻ cảm nhận của bạn', '') || '';
    try { await api('/reviews', { method: 'POST', body: JSON.stringify({ appointment_id: appointmentId, rating, comment }) }); setMessage('Cảm ơn bạn đã đánh giá.'); }
    catch (error: any) { setMessage(error.message); }
  }

  async function createBranch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const f = new FormData(form);
    const address = String(f.get('address') || branchAddress).trim();
    let lng = Number(f.get('lng') || branchLng);
    let lat = Number(f.get('lat') || branchLat);

    if ((!lng || !lat || (lng === 106.6917 && lat === 10.7719)) && address) {
      const resolved = await geocodeAddress(address);
      if (resolved) {
        [lng, lat] = resolved;
      }
    }

    try {
      await api('/admin/branches', {
        method: 'POST',
        body: JSON.stringify({
          name: f.get('name'),
          address,
          phone: f.get('phone'),
          coordinates: [lng, lat],
          open: f.get('open'),
          close: f.get('close')
        })
      });
      await loadCatalog();
      if (user?.role === 'ADMIN') await loadAdmin();
      form.reset();
      setBranchAddress('');
      setBranchLng('106.6917');
      setBranchLat('10.7719');
      setGeoStatus('');
      setMessage('Đã thêm chi nhánh.');
    } catch (error: any) { setMessage(error.message); }
  }

  async function createService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const f = new FormData(event.currentTarget);
    try {
      await api('/admin/services', { method: 'POST', body: JSON.stringify({
        name: f.get('name'),
        category: f.get('category'),
        description: f.get('description'),
        price: Number(f.get('price')),
        duration_minutes: Number(f.get('duration')),
        is_estimated: f.get('is_estimated') === 'on',
        branch_ids: [f.get('branch_id')]
      }) });
      if (user?.role === 'ADMIN') await loadAdmin();
      await loadCatalog(); event.currentTarget.reset(); setMessage('Đã thêm dịch vụ.');
    } catch (error: any) { setMessage(error.message); }
  }

  async function createStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const f = new FormData(event.currentTarget);
    try {
      await api('/admin/staff', { method: 'POST', body: JSON.stringify({
        name: f.get('name'), phone: f.get('phone'), password: f.get('password'), specialty: f.get('specialty'), branch_id: f.get('branch_id'),
        working_days: f.getAll('working_days').map(Number), work_open: f.get('work_open'), work_close: f.get('work_close'),
        break_start: f.get('break_start'), break_end: f.get('break_end'),
        days_off: String(f.get('days_off') || '').split(',').map(value => value.trim()).filter(Boolean)
      }) });
      await loadAdmin(); event.currentTarget.reset(); setMessage('Đã thêm nhân viên.');
    } catch (error: any) { setMessage(error.message); }
  }

  async function createCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    try {
      await api('/admin/categories', {
        method: 'POST',
        body: JSON.stringify({
          name: f.get('name'),
          description: f.get('description')
        })
      });
      if (user?.role === 'ADMIN') await loadAdmin();
      await loadCatalog();
      event.currentTarget.reset();
      setMessage('Đã thêm danh mục mới.');
    } catch (error: any) { setMessage(error.message); }
  }

  function editBranch(item: Item) { setEditingModal({ kind: 'branches', item }); }
  function editService(item: Item) { setEditingModal({ kind: 'services', item }); }
  function editStaff(item: Item) { setEditingModal({ kind: 'staff', item }); }
  function editCategory(item: Item) { setEditingModal({ kind: 'categories', item }); }

  async function handleSaveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingModal) return;
    const f = new FormData(event.currentTarget);
    const { kind, item } = editingModal;

    try {
      if (kind === 'branches') {
        const body: any = {
          name: f.get('name'),
          address: f.get('address'),
          phone: f.get('phone'),
          open: f.get('open'),
          close: f.get('close')
        };
        await api(`/admin/branches/${item._id}`, { method: 'PATCH', body: JSON.stringify(body) });
        await loadCatalog();
        setMessage('Đã cập nhật chi nhánh.');
      } else if (kind === 'services') {
        const body: any = {
          name: f.get('name'),
          category: f.get('category'),
          description: f.get('description'),
          price: Number(f.get('price')),
          duration_minutes: Number(f.get('duration')),
          is_estimated: f.get('is_estimated') === 'on'
        };
        const branchId = f.get('branch_id');
        if (branchId) body.branch_ids = [branchId];
        await api(`/admin/services/${item._id}`, { method: 'PATCH', body: JSON.stringify(body) });
        if (user?.role === 'ADMIN') await loadAdmin();
        await loadCatalog();
        setMessage('Đã cập nhật dịch vụ.');
      } else if (kind === 'staff') {
        const body: any = {
          name: f.get('name'),
          phone: f.get('phone'),
          specialty: f.get('specialty'),
          branch_id: f.get('branch_id'),
          working_days: f.getAll('working_days').map(Number),
          work_open: f.get('work_open'), work_close: f.get('work_close'),
          break_start: f.get('break_start'), break_end: f.get('break_end'),
          days_off: String(f.get('days_off') || '').split(',').map(value => value.trim()).filter(Boolean)
        };
        await api(`/admin/staff/${item._id}`, { method: 'PATCH', body: JSON.stringify(body) });
        await loadAdmin();
        setMessage('Đã cập nhật nhân viên.');
      } else if (kind === 'categories') {
        const body: any = {
          name: f.get('name'),
          description: f.get('description')
        };
        await api(`/admin/categories/${item._id}`, { method: 'PATCH', body: JSON.stringify(body) });
        if (user?.role === 'ADMIN') await loadAdmin();
        await loadCatalog();
        setMessage('Đã cập nhật danh mục.');
      }
      setEditingModal(null);
    } catch (error: any) {
      setMessage(error.message);
    }
  }

  async function toggleStatus(kind: 'branches' | 'services' | 'staff' | 'categories', item: Item) {
    const nextStatus = item.status === 'INACTIVE' ? 'ACTIVE' : 'INACTIVE';
    const actionText = nextStatus === 'INACTIVE' ? 'tạm ngừng' : 'kích hoạt lại';
    if (!confirm(`Bạn có chắc muốn ${actionText} “${item.name}”?`)) return;

    try {
      if (kind === 'branches') {
        await api(`/admin/branches/${item._id}`, { method: 'PATCH', body: JSON.stringify({ status: nextStatus }) });
      } else if (kind === 'services') {
        await api(`/admin/services/${item._id}`, { method: 'PATCH', body: JSON.stringify({ status: nextStatus }) });
      } else if (kind === 'staff') {
        await api(`/admin/users/${item._id}/status`, { method: 'PATCH', body: JSON.stringify({ status: nextStatus }) });
      } else if (kind === 'categories') {
        await api(`/admin/categories/${item._id}`, { method: 'PATCH', body: JSON.stringify({ status: nextStatus }) });
      }
      if (user?.role === 'ADMIN') await loadAdmin();
      await loadCatalog();
      setMessage(`Đã ${actionText} “${item.name}”.`);
    } catch (error: any) {
      setMessage(error.message);
    }
  }

  async function toggleUser(account: Item) {
    try {
      await api(`/admin/users/${account._id}/status`, { method: 'PATCH', body: JSON.stringify({ status: account.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }) });
      await loadAdmin(); setMessage('Đã cập nhật trạng thái tài khoản.');
    } catch (error: any) { setMessage(error.message); }
  }

  const allStaff = users.filter(account => account.role === 'STAFF');

  return <>
    <div className="scroll-progress" aria-hidden="true"></div><div className="ambient-cursor" aria-hidden="true"></div>
    <header>
      <a className="brand" href="#home"><span className="brand-mark">N</span><span>NexaSalon<small>BEAUTY & WELLNESS</small></span></a>
      <nav><a href="#services">Dịch vụ</a>{user?.role === 'CUSTOMER' && <a href="#booking">Đặt lịch</a>}{user && <a href="#workspace">Lịch hẹn</a>}</nav>
      <div className="account">{user ? <><span className="account-name"><i>{user.name?.charAt(0)}</i>{user.name}<small>{roleLabel(user.role)}</small></span><button className="small secondary" onClick={logout}>Đăng xuất</button></> : <a className="header-cta" href="#login">Đặt lịch</a>}</div>
    </header>

    <main>
      <section className="hero" id="home">
        <div className="hero-copy"><p className="eyebrow">CHĂM SÓC SẮC ĐẸP & THƯ GIÃN</p><h1>Vẻ đẹp của bạn,<br/><em>nghi thức của chúng tôi.</em></h1><p>Mỗi cuộc hẹn là một khoảng lặng riêng tư — nơi chuyên môn, sự tinh tế và cảm giác thư thái gặp nhau.</p><div className="hero-actions"><a href={user ? '#workspace' : '#login'} className="button">Đặt lịch trải nghiệm <span>↗</span></a><a href="#services" className="text-link">Khám phá dịch vụ <span>→</span></a></div><div className="hero-trust"><span><b>02</b> không gian</span><span><b>04</b> dịch vụ chọn lọc</span><span><b>15’</b> giữ lịch riêng</span></div></div>
        <div className="hero-art" aria-hidden="true"><div className="hero-particles"><i></i><i></i><i></i><i></i></div><div className="hero-ring"></div><div className="hero-silhouette"><span>N</span></div><div className="floating-card top"><small>TRẢI NGHIỆM</small><b>Chăm sóc riêng cho bạn</b></div><div className="floating-card bottom"><i>✦</i><span><b>Thư thái trọn vẹn</b><small>Từ khoảnh khắc đầu tiên</small></span></div></div>
      </section>

      <div className="experience-strip"><span>Chuyên viên tận tâm</span><i>✦</i><span>Không gian riêng tư</span><i>✦</i><span>Đặt lịch thuận tiện</span><i>✦</i><span>Chăm sóc cá nhân hóa</span></div>

      <section id="services">
        <div className="section-title"><div><p className="eyebrow">DỊCH VỤ NỔI BẬT · TOP 4 ĐƯỢC YÊU THÍCH</p><h2>Nghi thức chăm sóc<br/><em>hot nhất hiện nay.</em></h2></div><div className="section-aside"><p>Tuyển chọn 4 trải nghiệm làm đẹp và thư giãn được đặt nhiều nhất tại NexaSalon. Nhấp vào dịch vụ để chọn đặt lịch ngay.</p><button className="secondary" onClick={findNearest}>⌖ &nbsp; Tìm chi nhánh gần tôi</button></div></div>
        {branches.some(item => item.distance_meters !== undefined) && <div className="nearest-list">{branches.map(item => <span key={item._id}><b>{item.name}</b> · {(Number(item.distance_meters) / 1000).toFixed(1)} km</span>)}</div>}
        <div className="grid">{hotServices.map((service, index) => <article key={service._id} onClick={() => handleSelectHotService(service)} style={{ cursor: 'pointer' }} title={`Nhấp để đặt lịch “${service.name}”`}><div className="card-top"><span>0{index + 1}</span><i title="Nhấp để đặt lịch">↗</i></div><small>{service.category || 'CHĂM SÓC'} · ✦ HOT</small><h3>{service.name}</h3><p>{service.description || 'Liệu trình chăm sóc chuyên sâu mang lại cảm giác thư thái trọn vẹn.'}</p><div className="service-meta"><b>{cash(service.price || 0)}</b><span>{formatDuration(service.duration_minutes, service.is_estimated)}</span></div></article>)}</div>
      </section>

      {!user && <section className="login-section" id="login">
        <div className="auth-intro"><p className="eyebrow">KHÔNG GIAN CỦA BẠN</p><h2>{authMode === 'login' ? 'Chào mừng bạn trở lại.' : 'Bắt đầu hành trình chăm sóc.'}</h2><p>Đăng nhập để đặt lịch, theo dõi cuộc hẹn và lưu lại hành trình chăm sóc của riêng bạn.</p><div className="auth-signature"><span>NS</span><p><b>Private beauty ritual</b><small>Thiết kế riêng cho từng khoảnh khắc</small></p></div></div>
        {authMode === 'login' ? <form className="panel" onSubmit={login}><input name="phone" defaultValue="0900000004" placeholder="Số điện thoại" required/><input name="password" type="password" defaultValue="123456" placeholder="Mật khẩu" required/><button>Đăng nhập</button><small>Khách 1: 0900000004 · Khách 2: 0900000005 · Nhân viên: 0900000002 · Quản trị: 0900000001</small></form>
          : <form className="panel" onSubmit={register}><input name="name" placeholder="Họ và tên" required/><input name="phone" placeholder="Số điện thoại" required/><input name="password" type="password" minLength={6} placeholder="Mật khẩu từ 6 ký tự" required/><button>Tạo tài khoản</button><small>Bằng việc đăng ký, bạn đồng ý sử dụng thông tin để quản lý lịch hẹn.</small></form>}
        <div className="auth-tabs"><button className={authMode === 'login' ? 'active' : ''} onClick={() => setAuthMode('login')}>Đăng nhập</button><button className={authMode === 'register' ? 'active' : ''} onClick={() => setAuthMode('register')}>Tạo tài khoản</button></div>
      </section>}

      {user?.role === 'CUSTOMER' && <section id="booking" className="booking">
        <div className="booking-intro"><p className="eyebrow">ĐẶT LỊCH RIÊNG</p><h2>Một khoảng thời gian<br/><em>dành riêng cho bạn.</em></h2><p>Chọn chi nhánh, dịch vụ, chuyên viên và thời gian phù hợp. Khung giờ sẽ được giữ trong 15 phút để bạn hoàn tất xác nhận.</p><ol><li><b>01</b><span>Chọn trải nghiệm</span></li><li><b>02</b><span>Chọn chuyên viên</span></li><li><b>03</b><span>Xác nhận cuộc hẹn</span></li></ol></div>
        <div className="panel"><form onSubmit={holdSlot}>
          <select required value={branch} onChange={event => { setBranch(event.target.value); setChosen([]); setStaffId(''); releaseHold(); }}><option value="">Chọn chi nhánh</option>{branches.map(item => <option key={item._id} value={item._id}>{item.name}{item.distance_meters !== undefined ? ` · ${(item.distance_meters / 1000).toFixed(1)} km` : ''}</option>)}</select>
          <div className="checks">{available.map(service => <label key={service._id}><input type="checkbox" checked={chosen.includes(service._id)} onChange={() => { releaseHold(); setChosen(value => value.includes(service._id) ? value.filter(id => id !== service._id) : [...value, service._id]); }}/>{service.name}</label>)}</div>
          <select required value={staffId} onChange={event => { releaseHold(); setStaffId(event.target.value); }}><option value="">Chọn chuyên viên</option>{staff.map(item => <option key={item._id} value={item._id}>{item.name} · {item.specialty}</option>)}</select>
          <div className="row"><input aria-label="Ngày hẹn" required type="date" value={date} min={new Date().toISOString().slice(0, 10)} onChange={event => { releaseHold(); setDate(event.target.value); }}/><select aria-label="Giờ hẹn còn trống" required value={time} disabled={loadingAvailability || !availableSlots.length} onChange={event => { releaseHold(); setTime(event.target.value); }}><option value="">{loadingAvailability ? 'Đang tìm giờ trống...' : availableSlots.length ? 'Chọn giờ còn trống' : 'Không có giờ phù hợp'}</option>{availableSlots.map(slot => <option key={slot.start_time} value={slot.label}>{slot.label}</option>)}</select></div>
          <textarea value={note} onChange={event => setNote(event.target.value)} maxLength={500} placeholder="Ghi chú cho chuyên viên (không bắt buộc)"/>
          <div>
            <strong>{selected.some(s => s.is_estimated || (s.duration_minutes || 0) >= 90) ? 'Khoảng ' : ''}{selected.reduce((sum, service) => sum + (service.duration_minutes || 0), 0)} phút {selected.some(s => s.is_estimated || (s.duration_minutes || 0) >= 90) ? '(ước tính) ' : ''}· {cash(total)}</strong>
            {selected.some(s => s.is_estimated || (s.duration_minutes || 0) >= 90) && (
              <small style={{ display: 'block', color: 'var(--gold-light)', fontSize: '11px', marginTop: '4px' }}>
                ✦ Thời gian thực tế có thể thay đổi linh hoạt tùy tình trạng tóc/da của bạn.
              </small>
            )}
          </div>
          {!hold ? <button disabled={!chosen.length || !staffId || !time || loadingAvailability}>Giữ khung giờ</button> : <div className="hold"><b>Còn {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</b><div><button type="button" onClick={book}>Xác nhận đặt lịch</button><button type="button" className="secondary" onClick={releaseHold}>Chọn lại</button></div></div>}
        </form></div>
      </section>}

      {user && <section id="workspace" className={`workspace ${user.role.toLowerCase()}-workspace`}>
        <div className="workspace-head"><div><p className="eyebrow">{roleLabel(user.role).toUpperCase()}</p><h2>{user.role === 'ADMIN' ? 'Tổng quan vận hành' : user.role === 'STAFF' ? 'Lịch làm việc của tôi' : 'Hành trình chăm sóc'}</h2><p>Xin chào, {user.name}. Đây là những thông tin quan trọng dành cho bạn hôm nay.</p></div><button className="secondary" onClick={loadAppointments}>↻ &nbsp; Làm mới</button></div>
        {(user.role === 'STAFF' || user.role === 'ADMIN') && <div className="schedule-tabs"><button className={scheduleView === 'ALL' ? '' : 'secondary'} onClick={() => setScheduleView('ALL')}>Tất cả</button><button className={scheduleView === 'TODAY' ? '' : 'secondary'} onClick={() => setScheduleView('TODAY')}>Hôm nay</button><button className={scheduleView === 'WEEK' ? '' : 'secondary'} onClick={() => setScheduleView('WEEK')}>7 ngày tới</button></div>}

        {user.role === 'ADMIN' && report && <>
          <div className="metrics"><article><span>Doanh thu hoàn thành</span><b>{cash(report.totals.revenue || 0)}</b></article><article><span>Lịch hoàn thành</span><b>{report.totals.appointments || 0}</b></article><article><span>Dịch vụ phổ biến</span><b>{report.top_services[0]?.name || 'Chưa có'}</b></article></div>
          <div className="report-grid">
            <Chart title="Doanh thu theo chi nhánh" items={report.revenue_by_branch} valueKey="revenue" labelKey="branch_name" format={cash}/>
            <Chart title="Trạng thái lịch hẹn" items={report.status_counts} valueKey="count" labelKey="_id" format={(value: number) => String(value)} translate={statusLabel}/>
            <Chart title="Dịch vụ được chọn nhiều" items={report.top_services} valueKey="bookings" labelKey="name" format={(value: number) => `${value} lượt`}/>
            <Chart title="Đánh giá chuyên viên" items={report.staff_performance} valueKey="average_rating" labelKey="staff_name" format={(value: number) => `${Number(value).toFixed(1)} / 5`}/>
          </div>
        </>}

        <div className="appointment-list">{visibleAppointments.length ? visibleAppointments.map(item => <article key={item._id}>
          <div><h3>{item.services_booked.map(service => service.name).join(' · ')}</h3><p>{dateTime(item.time_slot.start_time)} · {item.staff.name} · {cash(item.total_amount)}</p><small>{item.booking_code} · Khách: {item.customer.name}</small><details><summary>Xem chi tiết</summary><p>Điện thoại khách: {item.customer.phone}</p><p>Ghi chú: {item.note || 'Không có'}</p><p>Kết thúc dự kiến: {dateTime(item.time_slot.end_time)}</p>{item.checked_in_at && <p>Khách đến: {dateTime(item.checked_in_at)}</p>}{item.started_at && <p>Bắt đầu thực tế: {dateTime(item.started_at)}</p>}{item.completed_at && <p>Hoàn thành thực tế: {dateTime(item.completed_at)}</p>}{item.reschedule_history?.map((entry, index) => <p key={`${entry.at}-${index}`}><b>Lần đổi {index + 1}:</b> {dateTime(entry.from.start_time)} · {entry.from.staff_name} → {dateTime(entry.to.start_time)} · {entry.to.staff_name}{entry.reason ? ` · ${entry.reason}` : ''}</p>)}</details></div>
          <div className="actions"><span className={`status ${item.status}`}>{statusLabel(item.status)}</span>{user.role === 'CUSTOMER' && item.status === 'CONFIRMED' && new Date(item.time_slot.start_time).getTime() - Date.now() >= 2 * 60 * 60_000 && <button className="secondary small" onClick={() => openReschedule(item)}>Đổi lịch</button>}{user.role === 'CUSTOMER' && item.status === 'CONFIRMED' && <button className="danger small" onClick={() => confirmCancellation(item._id)}>Hủy</button>}{user.role === 'CUSTOMER' && item.status === 'COMPLETED' && <button className="small" onClick={() => review(item._id)}>Đánh giá</button>}{(user.role === 'STAFF' || user.role === 'ADMIN') && item.status === 'CONFIRMED' && <button title={canCheckInNow(item) ? 'Xác nhận khách đã đến' : 'Chỉ thao tác từ 30 phút trước đến 60 phút sau giờ hẹn'} disabled={updatingAppointment === item._id || !canCheckInNow(item)} className="small" onClick={() => appointmentAction(item._id, 'CHECKED_IN')}>{canCheckInNow(item) ? 'Khách đã đến' : 'Chưa tới giờ'}</button>}{user.role === 'STAFF' && item.status === 'CONFIRMED' && Date.now() >= new Date(item.time_slot.start_time).getTime() + 15 * 60_000 && <button disabled={updatingAppointment === item._id} className="danger small" onClick={() => appointmentAction(item._id, 'NO_SHOW')}>Khách vắng</button>}{(user.role === 'STAFF' || user.role === 'ADMIN') && item.status === 'CHECKED_IN' && <button title={canStartNow(item) ? 'Bắt đầu phục vụ' : 'Chưa đến thời gian phục vụ'} disabled={updatingAppointment === item._id || !canStartNow(item)} className="small" onClick={() => appointmentAction(item._id, 'IN_PROGRESS')}>Bắt đầu</button>}{(user.role === 'STAFF' || user.role === 'ADMIN') && item.status === 'IN_PROGRESS' && <button title={canCompleteNow(item) ? 'Hoàn thành dịch vụ' : 'Không thể hoàn thành trước giờ hẹn'} disabled={updatingAppointment === item._id || !canCompleteNow(item)} className="small" onClick={() => appointmentAction(item._id, 'COMPLETED')}>Hoàn thành</button>}</div>
        </article>) : <p className="empty">Không có lịch hẹn trong khoảng thời gian này.</p>}</div>

        {user.role === 'ADMIN' && <>
          <div className="admin-grid">
            <form className="admin-card" onSubmit={createBranch}>
              <h3>Thêm chi nhánh</h3>
              <input name="name" placeholder="Tên chi nhánh" required />
              <div className="address-field-group">
                <input
                  name="address"
                  placeholder="Địa chỉ (VD: 140 Lê Trọng Tấn, Tây Thạnh, Tân Phú)"
                  value={branchAddress}
                  onChange={e => setBranchAddress(e.target.value)}
                  required
                />
                <div className="geo-actions">
                  <button
                    type="button"
                    className="small secondary"
                    disabled={isGeocoding || !branchAddress.trim()}
                    onClick={() => geocodeAddress()}
                    title="Tự động tra cứu kinh độ và vĩ độ từ địa chỉ đã nhập"
                  >
                    {isGeocoding ? 'Đang định vị...' : '⌕ Lấy tọa độ từ địa chỉ'}
                  </button>
                  <button
                    type="button"
                    className="small secondary"
                    disabled={isGeocoding}
                    onClick={useCurrentLocationForBranch}
                    title="Lấy tọa độ theo vị trí GPS hiện tại của thiết bị"
                  >
                    📍 Vị trí hiện tại
                  </button>
                </div>
              </div>
              {geoStatus && (
                <div className="geo-status-badge">
                  <span>{geoStatus}</span>
                  {branchLat && branchLng && (
                    <a
                      href={`https://www.google.com/maps?q=${branchLat},${branchLng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="map-preview-link"
                    >
                      Bản đồ ↗
                    </a>
                  )}
                </div>
              )}
              <input name="phone" placeholder="Điện thoại" />
              <div className="row">
                <div>
                  <span className="field-label">Giờ mở cửa</span>
                  <input name="open" type="time" defaultValue="08:30" required title="Giờ mở cửa chi nhánh" />
                </div>
                <div>
                  <span className="field-label">Giờ đóng cửa</span>
                  <input name="close" type="time" defaultValue="21:30" required title="Giờ đóng cửa chi nhánh" />
                </div>
              </div>
              <details className="geo-advanced">
                <summary>Tọa độ địa lý (Tự động thiết lập)</summary>
                <div className="row" style={{ marginTop: '8px' }}>
                  <div>
                    <span className="field-label">Kinh độ (Longitude)</span>
                    <input
                      name="lng"
                      type="number"
                      step="any"
                      placeholder="Kinh độ"
                      value={branchLng}
                      onChange={e => setBranchLng(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <span className="field-label">Vĩ độ (Latitude)</span>
                    <input
                      name="lat"
                      type="number"
                      step="any"
                      placeholder="Vĩ độ"
                      value={branchLat}
                      onChange={e => setBranchLat(e.target.value)}
                      required
                    />
                  </div>
                </div>
              </details>
              <button disabled={isGeocoding}>Thêm chi nhánh</button>
            </form>

            <form className="admin-card" onSubmit={createService}>
              <h3>Thêm dịch vụ</h3>
              <input name="name" placeholder="Tên dịch vụ" required />
              <select name="category" required defaultValue="">
                <option value="" disabled>-- Chọn danh mục dịch vụ --</option>
                {categoryOptions.map(cat => <option key={cat} value={cat}>{cat}</option>)}
              </select>
              <input name="description" placeholder="Mô tả" />
              <div className="row">
                <div>
                  <span className="field-label">Giá (VNĐ)</span>
                  <input name="price" type="number" min="0" placeholder="Giá (VNĐ)" required />
                </div>
                <div>
                  <span className="field-label">Thời lượng an toàn (phút)</span>
                  <input name="duration" type="number" min="5" placeholder="Số phút" required />
                </div>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', cursor: 'pointer', margin: '3px 0' }}>
                <input type="checkbox" name="is_estimated" style={{ width: 'auto' }} />
                <span>Thời lượng ước tính (linh hoạt theo tình trạng tóc / da của khách)</span>
              </label>
              <small style={{ color: 'var(--muted)', fontSize: '10px', marginTop: '-4px' }}>
                💡 Gợi ý: Với dịch vụ uốn, nhuộm, tẩy, phục hồi hoặc da, hãy đặt thời lượng đủ rộng (Buffer Time) để tránh trùng lịch chuyên viên.
              </small>
              <select name="branch_id" required defaultValue="">
                <option value="" disabled>-- Chọn chi nhánh áp dụng --</option>
                {branches.map(item => <option key={item._id} value={item._id}>{item.name}</option>)}
              </select>
              <button>Thêm dịch vụ</button>
            </form>

            <form className="admin-card" onSubmit={createStaff}>
              <h3>Thêm nhân viên</h3>
              <input name="name" placeholder="Họ tên" required />
              <input name="phone" placeholder="Số điện thoại" required />
              <input name="password" type="password" minLength={6} placeholder="Mật khẩu" required />
              <select name="specialty" required defaultValue="">
                <option value="" disabled>-- Chọn chuyên môn nhân viên --</option>
                {specialtyOptions.map(spec => <option key={spec} value={spec}>{spec}</option>)}
              </select>
              <select name="branch_id" required defaultValue="">
                <option value="" disabled>-- Chọn chi nhánh công tác --</option>
                {branches.map(item => <option key={item._id} value={item._id}>{item.name}</option>)}
              </select>
              <div><span className="field-label">Ngày làm việc</span><div className="schedule-days">{WEEKDAYS.map(day => <label key={day.value}><input type="checkbox" name="working_days" value={day.value} defaultChecked={day.value !== 0}/>{day.label}</label>)}</div></div>
              <div className="row"><div><span className="field-label">Bắt đầu ca</span><input name="work_open" type="time" defaultValue="09:00" required/></div><div><span className="field-label">Kết thúc ca</span><input name="work_close" type="time" defaultValue="18:00" required/></div></div>
              <div className="row"><div><span className="field-label">Bắt đầu nghỉ</span><input name="break_start" type="time" defaultValue="12:00"/></div><div><span className="field-label">Kết thúc nghỉ</span><input name="break_end" type="time" defaultValue="13:00"/></div></div>
              <input name="days_off" placeholder="Ngày nghỉ riêng, cách nhau dấu phẩy: 2026-11-02, 2026-11-05" />
              <button>Thêm nhân viên</button>
            </form>

            <form className="admin-card" onSubmit={createCategory}>
              <h3>Thêm danh mục dịch vụ</h3>
              <input name="name" placeholder="Tên danh mục (VD: Gội đầu dưỡng sinh, Chăm sóc da...)" required />
              <input name="description" placeholder="Mô tả danh mục (VD: Dịch vụ thư giãn da đầu và cổ vai gáy)" />
              <button>Thêm danh mục</button>
            </form>

            <div className="admin-card users"><h3>Tài khoản</h3>{users.map(account => <div key={account._id}><span>{account.name}<small>{roleLabel(account.role)} · {account.phone} · {account.status === 'ACTIVE' ? 'Đang hoạt động' : 'Đã khóa'}</small></span><button className="small secondary" onClick={() => toggleUser(account)}>{account.status === 'ACTIVE' ? 'Khóa' : 'Mở'}</button></div>)}</div>
          </div>
          <div className="management-grid">
            <ManageList title="Danh mục" items={categories} onEdit={editCategory} onToggleStatus={item => toggleStatus('categories', item)}/>
            <ManageList title="Chi nhánh" items={branches} onEdit={editBranch} onToggleStatus={item => toggleStatus('branches', item)}/>
            <ManageList title="Dịch vụ" items={services} onEdit={editService} onToggleStatus={item => toggleStatus('services', item)}/>
            <ManageList title="Nhân viên" items={allStaff} onEdit={editStaff} onToggleStatus={item => toggleStatus('staff', item)}/>
          </div>
          <section className="audit-card">
            <div className="audit-head"><div><p className="eyebrow">KIỂM SOÁT HỆ THỐNG</p><h3>Nhật ký quản trị</h3></div><button className="secondary small" onClick={loadAdmin}>↻ Làm mới</button></div>
            <div className="audit-list">{auditLog.length ? auditLog.map(entry => <details key={entry._id} className="audit-entry"><summary><span className={`audit-action ${entry.action}`}>{({ CREATE: 'Thêm', UPDATE: 'Sửa', ARCHIVE: 'Ngừng', STATUS_CHANGE: 'Trạng thái' } as Record<string,string>)[entry.action] || entry.action}</span><b>{entry.entity_type}</b><span>{entry.actor?.name || 'Không xác định'}</span><time>{dateTime(entry.created_at)}</time></summary><div className="audit-diff"><div><small>TRƯỚC THAY ĐỔI</small><pre>{entry.before ? JSON.stringify(entry.before, null, 2) : 'Không có dữ liệu trước'}</pre></div><div><small>SAU THAY ĐỔI</small><pre>{entry.after ? JSON.stringify(entry.after, null, 2) : 'Không có dữ liệu sau'}</pre></div></div></details>) : <p className="empty compact">Chưa có thao tác quản trị nào được ghi nhận.</p>}</div>
          </section>
        </>}
      </section>}
      {reschedule && (
        <div className="modal-backdrop" onClick={closeReschedule}>
          <div className="modal-content" onClick={event => event.stopPropagation()}>
            <div className="modal-header"><div><p className="eyebrow">ĐỔI LỊCH HẸN</p><h3>{reschedule.appointment.booking_code}</h3></div><button type="button" className="close-btn" onClick={closeReschedule}>✕</button></div>
            <div className="reschedule-current"><small>Lịch hiện tại</small><b>{dateTime(reschedule.appointment.time_slot.start_time)} · {reschedule.appointment.staff.name}</b></div>
            <form onSubmit={event => { event.preventDefault(); reschedule.hold ? confirmReschedule() : holdReschedule(); }}>
              <div><span className="field-label">Chuyên viên mới</span><select value={reschedule.staffId} disabled={Boolean(reschedule.hold)} onChange={event => setReschedule(value => value ? { ...value, staffId: event.target.value, time: '', slots: [] } : value)}>{reschedule.staff.map(item => <option key={item._id} value={item._id}>{item.name} · {item.specialty}</option>)}</select></div>
              <div className="row"><div><span className="field-label">Ngày mới</span><input type="date" min={new Date().toISOString().slice(0,10)} value={reschedule.date} disabled={Boolean(reschedule.hold)} onChange={event => setReschedule(value => value ? { ...value, date: event.target.value, time: '', slots: [] } : value)} required/></div><div><span className="field-label">Giờ còn trống</span><select value={reschedule.time} disabled={reschedule.loading || Boolean(reschedule.hold) || !reschedule.slots.length} onChange={event => setReschedule(value => value ? { ...value, time: event.target.value } : value)} required><option value="">{reschedule.loading ? 'Đang tải...' : reschedule.slots.length ? 'Chọn giờ' : 'Không có giờ trống'}</option>{reschedule.slots.map(slot => <option key={slot.start_time} value={slot.label}>{slot.label}</option>)}</select></div></div>
              <div><span className="field-label">Lý do đổi lịch</span><textarea value={reschedule.reason} disabled={Boolean(reschedule.hold)} maxLength={500} onChange={event => setReschedule(value => value ? { ...value, reason: event.target.value } : value)} placeholder="Ví dụ: Tôi có việc đột xuất"/></div>
              {reschedule.hold && <div className="reschedule-hold"><b>Giờ mới đang được giữ trong 15 phút</b><small>Lịch cũ vẫn còn hiệu lực cho đến khi bạn xác nhận.</small></div>}
              <div className="modal-footer"><button type="button" className="secondary" onClick={reschedule.hold ? resetRescheduleHold : closeReschedule}>{reschedule.hold ? 'Chọn lại' : 'Đóng'}</button><button disabled={reschedule.loading || !reschedule.time}>{reschedule.hold ? 'Xác nhận đổi lịch' : 'Giữ giờ mới'}</button></div>
            </form>
          </div>
        </div>
      )}
      {editingModal && (
        <div className="modal-backdrop" onClick={() => setEditingModal(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>
                {editingModal.kind === 'branches' && 'Chỉnh sửa chi nhánh'}
                {editingModal.kind === 'services' && 'Chỉnh sửa dịch vụ'}
                {editingModal.kind === 'staff' && 'Chỉnh sửa nhân viên'}
                {editingModal.kind === 'categories' && 'Chỉnh sửa danh mục'}
              </h3>
              <button type="button" className="close-btn" onClick={() => setEditingModal(null)}>✕</button>
            </div>
            <form onSubmit={handleSaveEdit}>
              {editingModal.kind === 'categories' && (
                <>
                  <div>
                    <span className="field-label">Tên danh mục</span>
                    <input name="name" defaultValue={editingModal.item.name} required />
                  </div>
                  <div>
                    <span className="field-label">Mô tả danh mục</span>
                    <input name="description" defaultValue={editingModal.item.description || ''} />
                  </div>
                </>
              )}

              {editingModal.kind === 'branches' && (
                <>
                  <div>
                    <span className="field-label">Tên chi nhánh</span>
                    <input name="name" defaultValue={editingModal.item.name} required />
                  </div>
                  <div>
                    <span className="field-label">Địa chỉ chi nhánh</span>
                    <input name="address" defaultValue={editingModal.item.address || ''} required />
                  </div>
                  <div>
                    <span className="field-label">Số điện thoại liên hệ</span>
                    <input name="phone" defaultValue={editingModal.item.phone || ''} />
                  </div>
                  <div className="row">
                    <div>
                      <span className="field-label">Giờ mở cửa</span>
                      <input name="open" type="time" defaultValue={editingModal.item.opening_hours?.open || '08:30'} required />
                    </div>
                    <div>
                      <span className="field-label">Giờ đóng cửa</span>
                      <input name="close" type="time" defaultValue={editingModal.item.opening_hours?.close || '21:30'} required />
                    </div>
                  </div>
                </>
              )}

              {editingModal.kind === 'services' && (
                <>
                  <div>
                    <span className="field-label">Tên dịch vụ</span>
                    <input name="name" defaultValue={editingModal.item.name} required />
                  </div>
                  <div>
                    <span className="field-label">Danh mục dịch vụ</span>
                    <select name="category" defaultValue={editingModal.item.category || ''} required>
                      <option value="" disabled>-- Chọn danh mục --</option>
                      {categoryOptions.map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <span className="field-label">Mô tả dịch vụ</span>
                    <input name="description" defaultValue={editingModal.item.description || ''} />
                  </div>
                  <div className="row">
                    <div>
                      <span className="field-label">Giá dịch vụ (VNĐ)</span>
                      <input name="price" type="number" min="0" defaultValue={editingModal.item.price || 0} required />
                    </div>
                    <div>
                      <span className="field-label">Thời lượng an toàn (phút)</span>
                      <input name="duration" type="number" min="5" defaultValue={editingModal.item.duration_minutes || 30} required />
                    </div>
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', cursor: 'pointer', margin: '4px 0' }}>
                    <input type="checkbox" name="is_estimated" defaultChecked={editingModal.item.is_estimated} style={{ width: 'auto' }} />
                    <span>Thời lượng ước tính (linh hoạt theo tình trạng tóc / da của khách)</span>
                  </label>
                  <div>
                    <span className="field-label">Chi nhánh áp dụng</span>
                    <select name="branch_id" defaultValue={editingModal.item.branch_ids?.[0] || ''} required>
                      <option value="" disabled>-- Chọn chi nhánh --</option>
                      {branches.map(b => (
                        <option key={b._id} value={b._id}>{b.name}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              {editingModal.kind === 'staff' && (
                <>
                  <div>
                    <span className="field-label">Họ và tên</span>
                    <input name="name" defaultValue={editingModal.item.name} required />
                  </div>
                  <div>
                    <span className="field-label">Số điện thoại</span>
                    <input name="phone" defaultValue={editingModal.item.phone || ''} required />
                  </div>
                  <div>
                    <span className="field-label">Chuyên môn</span>
                    <select name="specialty" defaultValue={editingModal.item.specialty || ''} required>
                      <option value="" disabled>-- Chọn chuyên môn --</option>
                      {specialtyOptions.map(spec => (
                        <option key={spec} value={spec}>{spec}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <span className="field-label">Chi nhánh công tác</span>
                    <select name="branch_id" defaultValue={editingModal.item.branch_id || ''} required>
                      <option value="" disabled>-- Chọn chi nhánh --</option>
                      {branches.map(b => (
                        <option key={b._id} value={b._id}>{b.name}</option>
                      ))}
                    </select>
                  </div>
                  <div><span className="field-label">Ngày làm việc</span><div className="schedule-days">{WEEKDAYS.map(day => <label key={day.value}><input type="checkbox" name="working_days" value={day.value} defaultChecked={(editingModal.item.working_days || [1,2,3,4,5,6]).includes(day.value)}/>{day.label}</label>)}</div></div>
                  <div className="row"><div><span className="field-label">Bắt đầu ca</span><input name="work_open" type="time" defaultValue={editingModal.item.working_hours?.open || '09:00'} required/></div><div><span className="field-label">Kết thúc ca</span><input name="work_close" type="time" defaultValue={editingModal.item.working_hours?.close || '18:00'} required/></div></div>
                  <div className="row"><div><span className="field-label">Bắt đầu nghỉ</span><input name="break_start" type="time" defaultValue={editingModal.item.break_hours?.start || '12:00'}/></div><div><span className="field-label">Kết thúc nghỉ</span><input name="break_end" type="time" defaultValue={editingModal.item.break_hours?.end || '13:00'}/></div></div>
                  <div><span className="field-label">Ngày nghỉ riêng</span><input name="days_off" defaultValue={(editingModal.item.days_off || []).join(', ')} placeholder="2026-11-02, 2026-11-05"/></div>
                </>
              )}

              <div className="modal-footer">
                <button type="button" className="secondary" onClick={() => setEditingModal(null)}>Hủy bỏ</button>
                <button type="submit">Lưu thay đổi</button>
              </div>
            </form>
          </div>
        </div>
      )}
      <p className="global-message" role="status">{message}</p>
    </main>
    <footer>NexaSalon · Nâng niu vẻ đẹp, trọn vẹn thư giãn</footer>
  </>;
}

function Chart({ title, items = [], valueKey, labelKey, format, translate }: any) {
  const maximum = maxValue(items, valueKey);
  return <section className="chart-card"><h3>{title}</h3>{items.length ? items.map((item: any) => <div className="bar-row" key={String(item._id || item[labelKey])}><div><span>{translate ? translate(item[labelKey]) : item[labelKey] || 'Chưa xác định'}</span><b>{format(item[valueKey] || 0)}</b></div><i style={{ width: `${Math.max(4, (Number(item[valueKey]) || 0) / maximum * 100)}%` }}/></div>) : <p className="empty compact">Chưa có dữ liệu.</p>}</section>;
}

function ManageList({ title, items, onEdit, onToggleStatus }: { title: string; items: Item[]; onEdit: (item: Item) => void; onToggleStatus: (item: Item) => void }) {
  return <section className="manage-card"><h3>Quản lý {title.toLowerCase()}</h3>{items.length ? items.map(item => {
    const isInactive = item.status === 'INACTIVE';
    return <div className="manage-row" key={item._id} style={{ opacity: isInactive ? 0.7 : 1 }}>
      <span className="manage-info">
        <b>{item.name}</b>
        <small className="manage-meta">
          <span className={`status ${isInactive ? 'CANCELLED' : 'CONFIRMED'}`}>{isInactive ? 'Tạm ngừng' : 'Hoạt động'}</span>
          <span>{item.address || item.specialty || item.category || item.description || item.phone}</span>
        </small>
      </span>
      <span className="inline-actions">
        <button className="small secondary" onClick={() => onEdit(item)}>Sửa</button>
        <button className={`small ${isInactive ? 'secondary' : 'danger'}`} onClick={() => onToggleStatus(item)}>{isInactive ? 'Mở lại' : 'Ngừng'}</button>
      </span>
    </div>;
  }) : <p className="empty compact">Chưa có dữ liệu.</p>}</section>;
}
