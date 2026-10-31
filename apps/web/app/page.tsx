'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';

type Item = {
  _id: string; name: string; description?: string; category?: string; price?: number;
  duration_minutes?: number; branch_ids?: string[]; branch_id?: string; specialty?: string;
  role?: string; status?: string; phone?: string; address?: string; distance_meters?: number;
  location?: { coordinates: number[] }; opening_hours?: { open: string; close: string };
};

type Appointment = {
  _id: string; booking_code: string; status: string; total_amount: number; note?: string;
  customer: { name: string; phone: string }; staff: { name: string };
  time_slot: { start_time: string; end_time: string };
  services_booked: Array<{ name: string; price: number; duration: number }>;
};

const cash = (value: number) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(value);
const dateTime = (value: string) => new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const roleLabel = (role = '') => ({ CUSTOMER: 'Khách hàng', STAFF: 'Nhân viên', ADMIN: 'Quản trị viên' }[role] || role);
const statusLabel = (status: string) => ({ CONFIRMED: 'Đã xác nhận', IN_PROGRESS: 'Đang phục vụ', COMPLETED: 'Hoàn thành', CANCELLED: 'Đã hủy' }[status] || status);

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

  async function loadCatalog(path = '/branches') {
    const [branchList, serviceList] = await Promise.all([api(path), api('/services')]);
    setBranches(branchList); setServices(serviceList);
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
    if (!user) return;
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
    start_time: date && time ? new Date(`${date}T${time}:00+07:00`).toISOString() : ''
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
      const [dashboard, accountList] = await Promise.all([api('/reports/dashboard'), api('/admin/users')]);
      setReport(dashboard); setUsers(accountList);
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

  async function appointmentAction(id: string, action: 'cancel' | 'IN_PROGRESS' | 'COMPLETED') {
    try {
      const path = action === 'cancel' ? `/appointments/${id}/cancel` : `/appointments/${id}/status`;
      const body = action === 'cancel' ? undefined : JSON.stringify({ status: action });
      await api(path, { method: 'PATCH', body });
      setMessage('Đã cập nhật lịch hẹn.'); await loadAppointments(); if (user?.role === 'ADMIN') await loadAdmin();
    } catch (error: any) { setMessage(error.message); }
  }

  function confirmCancellation(id: string) {
    if (window.confirm('Bạn có chắc chắn muốn hủy lịch hẹn này? Thao tác này không thể hoàn tác.')) appointmentAction(id, 'cancel');
  }

  async function review(appointmentId: string) {
    const rating = Number(prompt('Chấm điểm từ 1 đến 5', '5'));
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return setMessage('Điểm đánh giá phải từ 1 đến 5.');
    const comment = prompt('Chia sẻ cảm nhận của bạn', '') || '';
    try { await api('/reviews', { method: 'POST', body: JSON.stringify({ appointment_id: appointmentId, rating, comment }) }); setMessage('Cảm ơn bạn đã đánh giá.'); }
    catch (error: any) { setMessage(error.message); }
  }

  async function createBranch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const f = new FormData(event.currentTarget);
    try {
      await api('/admin/branches', { method: 'POST', body: JSON.stringify({ name: f.get('name'), address: f.get('address'), phone: f.get('phone'), coordinates: [Number(f.get('lng')), Number(f.get('lat'))], open: f.get('open'), close: f.get('close') }) });
      await loadCatalog(); event.currentTarget.reset(); setMessage('Đã thêm chi nhánh.');
    } catch (error: any) { setMessage(error.message); }
  }

  async function createService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const f = new FormData(event.currentTarget);
    try {
      await api('/admin/services', { method: 'POST', body: JSON.stringify({ name: f.get('name'), category: f.get('category'), description: f.get('description'), price: Number(f.get('price')), duration_minutes: Number(f.get('duration')), branch_ids: [f.get('branch_id')] }) });
      await loadCatalog(); event.currentTarget.reset(); setMessage('Đã thêm dịch vụ.');
    } catch (error: any) { setMessage(error.message); }
  }

  async function createStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const f = new FormData(event.currentTarget);
    try {
      await api('/admin/staff', { method: 'POST', body: JSON.stringify({ name: f.get('name'), phone: f.get('phone'), password: f.get('password'), specialty: f.get('specialty'), branch_id: f.get('branch_id') }) });
      await loadAdmin(); event.currentTarget.reset(); setMessage('Đã thêm nhân viên.');
    } catch (error: any) { setMessage(error.message); }
  }

  async function editBranch(item: Item) {
    const name = prompt('Tên chi nhánh', item.name); if (!name) return;
    const address = prompt('Địa chỉ', item.address || ''); if (!address) return;
    const phone = prompt('Số điện thoại', item.phone || '') ?? item.phone;
    try { await api(`/admin/branches/${item._id}`, { method: 'PATCH', body: JSON.stringify({ name, address, phone }) }); await loadCatalog(); setMessage('Đã cập nhật chi nhánh.'); }
    catch (error: any) { setMessage(error.message); }
  }

  async function editService(item: Item) {
    const name = prompt('Tên dịch vụ', item.name); if (!name) return;
    const price = Number(prompt('Giá dịch vụ', String(item.price || 0)));
    const duration_minutes = Number(prompt('Thời lượng (phút)', String(item.duration_minutes || 30)));
    if (!Number.isFinite(price) || !Number.isInteger(duration_minutes)) return setMessage('Giá hoặc thời lượng không hợp lệ.');
    try { await api(`/admin/services/${item._id}`, { method: 'PATCH', body: JSON.stringify({ name, price, duration_minutes }) }); await loadCatalog(); setMessage('Đã cập nhật dịch vụ.'); }
    catch (error: any) { setMessage(error.message); }
  }

  async function editStaff(item: Item) {
    const name = prompt('Họ tên', item.name); if (!name) return;
    const specialty = prompt('Chuyên môn', item.specialty || ''); if (!specialty) return;
    try { await api(`/admin/staff/${item._id}`, { method: 'PATCH', body: JSON.stringify({ name, specialty }) }); await loadAdmin(); setMessage('Đã cập nhật nhân viên.'); }
    catch (error: any) { setMessage(error.message); }
  }

  async function archive(kind: 'branches' | 'services' | 'staff', item: Item) {
    if (!confirm(`Ngừng hoạt động “${item.name}”? Dữ liệu cũ vẫn được giữ lại.`)) return;
    try { await api(`/admin/${kind}/${item._id}`, { method: 'DELETE' }); await loadCatalog(); await loadAdmin(); setMessage('Đã ngừng hoạt động.'); }
    catch (error: any) { setMessage(error.message); }
  }

  async function toggleUser(account: Item) {
    try {
      await api(`/admin/users/${account._id}/status`, { method: 'PATCH', body: JSON.stringify({ status: account.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }) });
      await loadAdmin(); setMessage('Đã cập nhật trạng thái tài khoản.');
    } catch (error: any) { setMessage(error.message); }
  }

  const activeStaff = users.filter(account => account.role === 'STAFF' && account.status === 'ACTIVE');

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
        <div className="section-title"><div><p className="eyebrow">BỘ SƯU TẬP DỊCH VỤ</p><h2>Nghi thức chăm sóc<br/><em>được tuyển chọn.</em></h2></div><div className="section-aside"><p>Từ tạo kiểu đến thư giãn chuyên sâu, mỗi dịch vụ được thiết kế để tôn lên phiên bản rạng rỡ nhất của bạn.</p><button className="secondary" onClick={findNearest}>⌖ &nbsp; Tìm chi nhánh gần tôi</button></div></div>
        {branches.some(item => item.distance_meters !== undefined) && <div className="nearest-list">{branches.map(item => <span key={item._id}><b>{item.name}</b> · {(Number(item.distance_meters) / 1000).toFixed(1)} km</span>)}</div>}
        <div className="grid">{services.map((service, index) => <article key={service._id}><div className="card-top"><span>0{index + 1}</span><i>↗</i></div><small>{service.category || 'CHĂM SÓC'}</small><h3>{service.name}</h3><p>{service.description}</p><div className="service-meta"><b>{cash(service.price || 0)}</b><span>{service.duration_minutes} phút</span></div></article>)}</div>
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
          <div className="row"><input aria-label="Ngày hẹn" required type="date" value={date} min={new Date().toISOString().slice(0, 10)} onChange={event => { releaseHold(); setDate(event.target.value); }}/><input aria-label="Giờ hẹn" required type="time" value={time} onChange={event => { releaseHold(); setTime(event.target.value); }}/></div>
          <textarea value={note} onChange={event => setNote(event.target.value)} maxLength={500} placeholder="Ghi chú cho chuyên viên (không bắt buộc)"/>
          <strong>{selected.reduce((sum, service) => sum + (service.duration_minutes || 0), 0)} phút · {cash(total)}</strong>
          {!hold ? <button disabled={!chosen.length || !staffId}>Giữ khung giờ</button> : <div className="hold"><b>Còn {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</b><div><button type="button" onClick={book}>Xác nhận đặt lịch</button><button type="button" className="secondary" onClick={releaseHold}>Chọn lại</button></div></div>}
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
          <div><h3>{item.services_booked.map(service => service.name).join(' · ')}</h3><p>{dateTime(item.time_slot.start_time)} · {item.staff.name} · {cash(item.total_amount)}</p><small>{item.booking_code} · Khách: {item.customer.name}</small><details><summary>Xem chi tiết</summary><p>Điện thoại khách: {item.customer.phone}</p><p>Ghi chú: {item.note || 'Không có'}</p><p>Kết thúc dự kiến: {dateTime(item.time_slot.end_time)}</p></details></div>
          <div className="actions"><span className={`status ${item.status}`}>{statusLabel(item.status)}</span>{user.role === 'CUSTOMER' && item.status === 'CONFIRMED' && <button className="danger small" onClick={() => confirmCancellation(item._id)}>Hủy</button>}{user.role === 'CUSTOMER' && item.status === 'COMPLETED' && <button className="small" onClick={() => review(item._id)}>Đánh giá</button>}{(user.role === 'STAFF' || user.role === 'ADMIN') && item.status === 'CONFIRMED' && <button className="small" onClick={() => appointmentAction(item._id, 'IN_PROGRESS')}>Bắt đầu</button>}{(user.role === 'STAFF' || user.role === 'ADMIN') && item.status === 'IN_PROGRESS' && <button className="small" onClick={() => appointmentAction(item._id, 'COMPLETED')}>Hoàn thành</button>}</div>
        </article>) : <p className="empty">Không có lịch hẹn trong khoảng thời gian này.</p>}</div>

        {user.role === 'ADMIN' && <>
          <div className="admin-grid">
            <form className="admin-card" onSubmit={createBranch}><h3>Thêm chi nhánh</h3><input name="name" placeholder="Tên chi nhánh" required/><input name="address" placeholder="Địa chỉ" required/><input name="phone" placeholder="Điện thoại"/><div className="row"><input name="lng" type="number" step="any" placeholder="Kinh độ" required/><input name="lat" type="number" step="any" placeholder="Vĩ độ" required/></div><div className="row"><input name="open" type="time" defaultValue="08:30" required/><input name="close" type="time" defaultValue="21:30" required/></div><button>Thêm chi nhánh</button></form>
            <form className="admin-card" onSubmit={createService}><h3>Thêm dịch vụ</h3><input name="name" placeholder="Tên dịch vụ" required/><input name="category" placeholder="Danh mục" required/><input name="description" placeholder="Mô tả"/><div className="row"><input name="price" type="number" min="0" placeholder="Giá" required/><input name="duration" type="number" min="5" placeholder="Số phút" required/></div><select name="branch_id" required><option value="">Chi nhánh</option>{branches.map(item => <option key={item._id} value={item._id}>{item.name}</option>)}</select><button>Thêm dịch vụ</button></form>
            <form className="admin-card" onSubmit={createStaff}><h3>Thêm nhân viên</h3><input name="name" placeholder="Họ tên" required/><input name="phone" placeholder="Số điện thoại" required/><input name="password" type="password" minLength={6} placeholder="Mật khẩu" required/><input name="specialty" placeholder="Chuyên môn" required/><select name="branch_id" required><option value="">Chi nhánh</option>{branches.map(item => <option key={item._id} value={item._id}>{item.name}</option>)}</select><button>Thêm nhân viên</button></form>
            <div className="admin-card users"><h3>Tài khoản</h3>{users.map(account => <div key={account._id}><span>{account.name}<small>{roleLabel(account.role)} · {account.phone} · {account.status === 'ACTIVE' ? 'Đang hoạt động' : 'Đã khóa'}</small></span><button className="small secondary" onClick={() => toggleUser(account)}>{account.status === 'ACTIVE' ? 'Khóa' : 'Mở'}</button></div>)}</div>
          </div>
          <div className="management-grid">
            <ManageList title="Chi nhánh" items={branches} onEdit={editBranch} onArchive={item => archive('branches', item)}/>
            <ManageList title="Dịch vụ" items={services} onEdit={editService} onArchive={item => archive('services', item)}/>
            <ManageList title="Nhân viên" items={activeStaff} onEdit={editStaff} onArchive={item => archive('staff', item)}/>
          </div>
        </>}
      </section>}
      <p className="global-message" role="status">{message}</p>
    </main>
    <footer>NexaSalon · Nâng niu vẻ đẹp, trọn vẹn thư giãn</footer>
  </>;
}

function Chart({ title, items = [], valueKey, labelKey, format, translate }: any) {
  const maximum = maxValue(items, valueKey);
  return <section className="chart-card"><h3>{title}</h3>{items.length ? items.map((item: any) => <div className="bar-row" key={String(item._id || item[labelKey])}><div><span>{translate ? translate(item[labelKey]) : item[labelKey] || 'Chưa xác định'}</span><b>{format(item[valueKey] || 0)}</b></div><i style={{ width: `${Math.max(4, (Number(item[valueKey]) || 0) / maximum * 100)}%` }}/></div>) : <p className="empty compact">Chưa có dữ liệu.</p>}</section>;
}

function ManageList({ title, items, onEdit, onArchive }: { title: string; items: Item[]; onEdit: (item: Item) => void; onArchive: (item: Item) => void }) {
  return <section className="manage-card"><h3>Quản lý {title.toLowerCase()}</h3>{items.length ? items.map(item => <div key={item._id}><span><b>{item.name}</b><small>{item.address || item.specialty || item.category || item.phone}</small></span><span className="inline-actions"><button className="small secondary" onClick={() => onEdit(item)}>Sửa</button><button className="small danger" onClick={() => onArchive(item)}>Ngừng</button></span></div>) : <p className="empty compact">Chưa có dữ liệu.</p>}</section>;
}
