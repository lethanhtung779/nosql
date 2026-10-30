const state = { token: localStorage.getItem('token'), user: JSON.parse(localStorage.getItem('user') || 'null'), branches: [], services: [], staff: [] };
const $ = (selector) => document.querySelector(selector);
const money = (value) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(value);
const dateTime = (value) => new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}), ...options.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'Có lỗi xảy ra');
  return data;
}

function toast(text) { const el = $('#toast'); el.textContent = text; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 2800); }
function updateAuth() { $('#authButton').textContent = state.user ? `${state.user.name} · Thoát` : 'Đăng nhập'; if (state.user) loadAppointments(); }

async function initCatalog() {
  [state.branches, state.services] = await Promise.all([api('/branches'), api('/services')]);
  $('#branch').innerHTML = '<option value="">Chọn chi nhánh</option>' + state.branches.map((b) => `<option value="${b._id}">${b.name}</option>`).join('');
  $('#serviceCards').innerHTML = state.services.map((s) => `<article class="service-card"><div class="icon">${s.category === 'Spa' ? '✦' : '✂'}</div><h3>${s.name}</h3><p>${s.description}</p><div class="service-meta"><span>${s.duration_minutes} phút</span><b>${money(s.price)}</b></div></article>`).join('');
}

$('#branch').addEventListener('change', async (event) => {
  const id = event.target.value;
  const services = state.services.filter((s) => s.branch_ids.includes(id));
  $('#serviceOptions').innerHTML = services.length ? services.map((s) => `<label class="check"><input type="checkbox" name="service" value="${s._id}" data-price="${s.price}" data-duration="${s.duration_minutes}"><span>${s.name}</span></label>`).join('') : '<span>Không có dịch vụ</span>';
  state.staff = id ? await api(`/staff?branch_id=${id}`) : [];
  $('#staff').innerHTML = '<option value="">Chọn chuyên viên</option>' + state.staff.map((s) => `<option value="${s._id}">${s.name} · ${s.specialty || 'Chuyên viên'}</option>`).join('');
  updateSummary();
});
$('#serviceOptions').addEventListener('change', updateSummary);
function updateSummary() { const selected = [...document.querySelectorAll('[name=service]:checked')]; const price = selected.reduce((n, el) => n + Number(el.dataset.price), 0); const duration = selected.reduce((n, el) => n + Number(el.dataset.duration), 0); $('#summary b').textContent = `${duration} phút · ${money(price)}`; }

$('#bookingForm').addEventListener('submit', async (event) => {
  event.preventDefault(); const message = $('#bookingMessage'); message.className = 'message'; message.textContent = '';
  if (!state.user) { $('#authDialog').showModal(); return; }
  if (state.user.role !== 'CUSTOMER') { message.textContent = 'Chỉ tài khoản khách hàng có thể đặt lịch.'; return; }
  const service_ids = [...document.querySelectorAll('[name=service]:checked')].map((el) => el.value);
  if (!service_ids.length) { message.textContent = 'Vui lòng chọn ít nhất một dịch vụ.'; return; }
  try {
    const local = new Date(`${$('#date').value}T${$('#time').value}:00+07:00`);
    const result = await api('/appointments', { method: 'POST', body: JSON.stringify({ branch_id: $('#branch').value, staff_id: $('#staff').value, service_ids, start_time: local.toISOString(), note: $('#note').value }) });
    message.className = 'message success'; message.textContent = `Đặt lịch thành công · ${result.booking_code}`; toast('Lịch hẹn đã được xác nhận'); loadAppointments();
  } catch (error) { message.textContent = error.message; }
});

const dialog = $('#authDialog'); let registerMode = false;
$('#authButton').addEventListener('click', () => { if (state.user) { state.token = null; state.user = null; localStorage.removeItem('token'); localStorage.removeItem('user'); updateAuth(); $('#appointmentList').innerHTML = '<p class="empty">Đăng nhập để xem lịch hẹn của bạn.</p>'; toast('Đã đăng xuất'); } else dialog.showModal(); });
$('.close').addEventListener('click', () => dialog.close());
$('#authSwitch').addEventListener('click', () => { registerMode = !registerMode; $('#authTitle').textContent = registerMode ? 'Tạo tài khoản' : 'Đăng nhập'; $('#nameField').hidden = !registerMode; $('#authSwitch').textContent = registerMode ? 'Đã có tài khoản? Đăng nhập' : 'Chưa có tài khoản? Đăng ký'; });
$('#authForm').addEventListener('submit', async (event) => {
  event.preventDefault(); const message = $('#authMessage'); message.textContent = '';
  try { const result = await api(`/auth/${registerMode ? 'register' : 'login'}`, { method: 'POST', body: JSON.stringify({ name: $('#authName').value, phone: $('#authPhone').value, password: $('#authPassword').value }) }); state.token = result.token; state.user = result.user; localStorage.setItem('token', result.token); localStorage.setItem('user', JSON.stringify(result.user)); dialog.close(); updateAuth(); toast(`Xin chào ${state.user.name}`); } catch (error) { message.textContent = error.message; }
});

async function loadAppointments() {
  if (!state.user) return;
  try { const items = await api('/appointments/mine'); $('#appointmentList').innerHTML = items.length ? items.map(renderAppointment).join('') : '<p class="empty">Bạn chưa có lịch hẹn nào.</p>'; } catch { $('#appointmentList').innerHTML = '<p class="empty">Không thể tải lịch hẹn. Vui lòng đăng nhập lại.</p>'; }
}
function renderAppointment(a) { const d = new Date(a.time_slot.start_time); return `<article class="appointment"><div class="date-badge"><b>${d.getDate()}</b><span>Tháng ${d.getMonth() + 1}</span></div><div><h3>${a.services_booked.map((s) => s.name).join(' · ')}</h3><p>${dateTime(a.time_slot.start_time)} · ${a.staff.name} · ${money(a.total_amount)}</p></div><span class="status ${a.status}">${a.status}</span></article>`; }
$('#refreshAppointments').addEventListener('click', loadAppointments);

const tomorrow = new Date(Date.now() + 86400000); $('#date').min = tomorrow.toISOString().slice(0, 10); $('#date').value = tomorrow.toISOString().slice(0, 10);
initCatalog().catch(() => toast('Không thể kết nối máy chủ')); updateAuth();
