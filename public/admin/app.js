'use strict';

const API = '/api/v1';
const PAGE = 25;
let token = null;
let adminInfo = null;
try { token = sessionStorage.getItem('admin_token'); adminInfo = JSON.parse(sessionStorage.getItem('admin_info') || 'null'); } catch (e) { /* hakuna hifadhi */ }

// ---------- Zana ndogo ----------

/** Inatengeneza kipengele cha DOM. Maandishi yote huwekwa kama text (salama dhidi ya XSS). */
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 4000);
}

const tzs = (n) => 'TZS ' + Math.round(Number(n) || 0).toLocaleString('en-US');
const dt = (s) => (s ? new Date(s).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }) : '-');
const nowPeriod = () => {
  const d = new Date(Date.now() + 3 * 3600 * 1000); // saa za Tanzania
  return d.toISOString().slice(0, 7);
};

const LABELS = {
  requested: 'Linasubiri', accepted: 'Limekubaliwa', arrived: 'Amefika', in_progress: 'Inaendelea',
  completed: 'Imekamilika', cancelled: 'Imeghairiwa', no_driver: 'Hakuna dereva',
  pending: 'Inasubiri', approved: 'Imethibitishwa', rejected: 'Imekataliwa', suspended: 'Imesimamishwa',
  blocked: 'Imezuiwa', active: 'Ruhusiwa',
  unpaid: 'Haijalipwa', partial: 'Sehemu', paid: 'Imelipwa', expired: 'Imechelewa',
  bodaboda: 'Bodaboda', bajaji: 'Bajaji', taxi: 'Taxi',
};
const label = (s) => LABELS[s] || s;
const TONE = {
  completed: 'ok', approved: 'ok', paid: 'ok', active: 'ok',
  pending: 'warn', requested: 'warn', partial: 'warn', accepted: 'warn', arrived: 'warn', in_progress: 'warn',
  rejected: 'bad', blocked: 'bad', suspended: 'bad', expired: 'bad', cancelled: 'bad', no_driver: 'bad', unpaid: 'warn',
};
const chip = (s) => h('span', { class: 'chip ' + (TONE[s] || '') }, label(s));

async function api(method, path, body) {
  let res;
  try {
    res = await fetch(API + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new Error('Imeshindwa kuwasiliana na server.');
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* si JSON */ }
  if (res.ok) return data;
  if (res.status === 401 && token) { logout(); throw new Error('Kikao kimeisha. Ingia tena.'); }
  throw new Error((data && data.error && data.error.message) || 'Hitilafu (' + res.status + ')');
}

const qs = (o) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== '' && v !== null && v !== undefined) p.set(k, v);
  const s = p.toString();
  return s ? '?' + s : '';
};

async function guard(fn) {
  try { return await fn(); } catch (e) { toast(e.message); return undefined; }
}

function table(columns, rows, onRow) {
  if (!rows.length) return h('div', { class: 'tablewrap' }, h('div', { class: 'empty' }, 'Hakuna data.'));
  return h('div', { class: 'tablewrap' }, h('table', {},
    h('thead', {}, h('tr', {}, columns.map((c) => h('th', {}, c.title)))),
    h('tbody', {}, rows.map((r) => h('tr', onRow ? { class: 'click', onclick: () => onRow(r) } : {},
      columns.map((c) => h('td', {}, c.cell(r))))))));
}

function select(options, value, onchange) {
  return h('select', { onchange: (e) => onchange(e.target.value) },
    options.map(([v, t]) => h('option', { value: v, selected: v === value }, t)));
}

function pager(state, total, reload) {
  return h('div', { class: 'pager' },
    h('button', { disabled: state.offset === 0, onclick: () => { state.offset = Math.max(0, state.offset - PAGE); reload(); } }, 'Nyuma'),
    h('span', { class: 'muted' }, total ? `${state.offset + 1}-${Math.min(state.offset + PAGE, total)} kati ya ${total}` : '0'),
    h('button', { disabled: state.offset + PAGE >= total, onclick: () => { state.offset += PAGE; reload(); } }, 'Mbele'));
}

function modal(title, content) {
  const bg = h('div', { class: 'modal-bg', onclick: (e) => { if (e.target === bg) bg.remove(); } },
    h('div', { class: 'modal' }, h('h3', {}, title), content,
      h('div', { style: 'margin-top:16px;text-align:right' }, h('button', { onclick: () => bg.remove() }, 'Funga'))));
  document.body.append(bg);
}

// ---------- Kuingia ----------

function logout() {
  token = null; adminInfo = null;
  try { sessionStorage.removeItem('admin_token'); sessionStorage.removeItem('admin_info'); } catch (e) { /* */ }
  render();
}

function loginView() {
  const email = h('input', { type: 'email', autocomplete: 'username', required: true });
  const pass = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const btn = h('button', { class: 'primary', style: 'width:100%;margin-top:16px', type: 'submit' }, 'Ingia');
  return h('form', {
    class: 'login',
    onsubmit: async (e) => {
      e.preventDefault();
      btn.disabled = true;
      try {
        const r = await api('POST', '/admin/auth/login', { email: email.value.trim(), password: pass.value });
        token = r.token; adminInfo = r.admin;
        try { sessionStorage.setItem('admin_token', token); sessionStorage.setItem('admin_info', JSON.stringify(adminInfo)); } catch (x) { /* */ }
        render();
      } catch (err) {
        toast(err.message);
        btn.disabled = false;
      }
    },
  }, h('h2', {}, 'Usafiri - Admin'),
  h('label', {}, 'Barua pepe'), email, h('label', {}, 'Neno la siri'), pass, btn);
}

// ---------- Kurasa ----------

const TABS = [
  ['summary', 'Muhtasari'], ['rides', 'Order'], ['owners', 'Wamiliki'], ['vehicles', 'Vyombo'],
  ['invoices', 'Ada na malipo'], ['passengers', 'Abiria'], ['settings', 'Bei na ada'],
];
let currentTab = 'summary';

async function summaryPage(box) {
  const s = await api('GET', '/admin/reports/summary');
  const by = (arr, key) => Object.fromEntries((arr || []).map((x) => [x.status, x[key]]));
  const owners = by(s.owners_by_status, 'count');
  const fees = (s.owner_fees.by_status || []);
  const feeTotal = fees.reduce((a, x) => a + x.amount, 0);
  const feePaid = fees.reduce((a, x) => a + x.paid_amount, 0);
  const card = (n, l) => h('div', { class: 'card' }, h('div', { class: 'n' }, n), h('div', { class: 'l' }, l));

  box.append(
    h('p', { class: 'muted' }, `Safari za siku 30 zilizopita (${dt(s.range.from)} hadi ${dt(s.range.to)})`),
    h('div', { class: 'cards' },
      card(s.completed.count, 'Safari zilizokamilika'),
      card(tzs(s.completed.fare_total_cash), 'Nauli (taslimu kwa madereva)'),
      card(Number(s.completed.km_total).toFixed(0) + ' km', 'Umbali uliosafirishwa'),
      card(s.vehicles.online, 'Vyombo Online sasa'),
      card(s.vehicles.pending_approval, 'Vyombo vinavyosubiri uthibitisho'),
      card(owners.pending || 0, 'Wamiliki wanaosubiri uthibitisho')),
    h('div', { class: 'panel' }, h('h3', {}, `Ada ya mwezi (${s.owner_fees.period})`),
      h('p', {}, `Imelipwa ${tzs(feePaid)} kati ya ${tzs(feeTotal)}`),
      h('div', { class: 'actions' }, fees.map((f) => h('span', {}, chip(f.status), ' ', f.count)))),
    h('div', { class: 'panel' }, h('h3', {}, 'Safari kwa hali'),
      h('div', { class: 'actions' }, (s.rides_by_status || []).map((f) => h('span', {}, chip(f.status), ' ', f.count)))),
    h('div', { class: 'panel' }, h('h3', {}, 'Vyombo vilivyofanya safari nyingi'),
      table([
        { title: 'Plate', cell: (r) => r.plate_no },
        { title: 'Safari', cell: (r) => r.rides },
      ], s.top_vehicles || [])));
}

async function ridesPage(box) {
  const st = { status: '', offset: 0 };
  const list = h('div');
  const load = async () => {
    await guard(async () => {
      const r = await api('GET', '/admin/rides' + qs({ status: st.status, limit: PAGE, offset: st.offset }));
      list.replaceChildren(
        table([
          { title: 'Muda', cell: (x) => dt(x.requested_at) },
          { title: 'Abiria', cell: (x) => x.passenger ? [x.passenger.name || '-', h('div', { class: 'muted' }, x.passenger.phone || '')] : '-' },
          { title: 'Chombo', cell: (x) => x.vehicle ? `${label(x.vehicle.type)} ${x.vehicle.plate_no}` : '-' },
          { title: 'Safari', cell: (x) => `${x.pickup || '?'} -> ${x.dropoff || '?'}` },
          { title: 'Km', cell: (x) => Number(x.distance_km).toFixed(1) },
          { title: 'Nauli', cell: (x) => tzs(x.fare) },
          { title: 'Hali', cell: (x) => chip(x.status) },
        ], r.rides, (x) => rideDetail(x.id)),
        pager(st, r.total, load));
    });
  };
  box.append(
    h('div', { class: 'filters' }, select([['', 'Hali zote'], ...Object.keys(LABELS).slice(0, 7).map((k) => [k, label(k)])], '', (v) => { st.status = v; st.offset = 0; load(); })),
    list);
  await load();
}

async function rideDetail(id) {
  await guard(async () => {
    const r = await api('GET', '/admin/rides/' + id);
    const rows = [
      ['Hali', chip(r.status)], ['Nauli', tzs(r.fare)], ['Umbali', Number(r.distance_km).toFixed(1) + ' km'],
      ['Kutoka', r.pickup.address], ['Kwenda', r.dropoff.address],
      ['Abiria', r.passenger ? `${r.passenger.name || '-'} ${r.passenger.phone || ''}` : '-'],
      ['Chombo', r.vehicle ? `${label(r.vehicle.type)} ${r.vehicle.plate_no}` : '-'],
      ['Mmiliki', r.owner ? `${r.owner.name} ${r.owner.phone}` : '-'],
      ['Dereva', r.driver ? `${r.driver.name} ${r.driver.phone}` : 'Mmiliki mwenyewe'],
      ['Aliomba', dt(r.requested_at)], ['Alikubali', dt(r.accepted_at)], ['Alifika', dt(r.arrived_at)],
      ['Alianza', dt(r.started_at)], ['Alimaliza', dt(r.completed_at)],
      ['Ilighairiwa na', r.cancelled_by || '-'],
    ];
    modal('Safari', h('div', { class: 'kv' }, rows.map(([k, v]) => [h('div', {}, k), h('div', {}, v)])));
  });
}


async function setStatus(path, status, needReason, reload) {
  let reason;
  if (needReason) {
    reason = window.prompt('Sababu (hiari):', '');
    if (reason === null) return;
  }
  await guard(async () => {
    await api('PATCH', path, { status, ...(reason ? { reason } : {}) });
    toast('Imehifadhiwa.');
    await reload();
  });
}

async function ownersPage(box) {
  const st = { status: 'pending', q: '', offset: 0 };
  const list = h('div');
  const load = async () => {
    await guard(async () => {
      const r = await api('GET', '/admin/owners' + qs({ status: st.status, q: st.q, limit: PAGE, offset: st.offset }));
      list.replaceChildren(
        table([
          { title: 'Jina', cell: (o) => o.name },
          { title: 'Simu', cell: (o) => o.phone },
          { title: 'Kitambulisho', cell: (o) => o.id_document || '-' },
          { title: 'Alijisajili', cell: (o) => dt(o.created_at) },
          { title: 'Hali', cell: (o) => chip(o.status) },
          { title: 'Hatua', cell: (o) => h('div', { class: 'actions' },
            o.status !== 'approved' && h('button', { class: 'small primary', onclick: () => setStatus(`/admin/owners/${o.id}/status`, 'approved', false, load) }, 'Thibitisha'),
            o.status === 'pending' && h('button', { class: 'small', onclick: () => setStatus(`/admin/owners/${o.id}/status`, 'rejected', true, load) }, 'Kataa'),
            o.status !== 'blocked' && h('button', { class: 'small danger', onclick: () => setStatus(`/admin/owners/${o.id}/status`, 'blocked', true, load) }, 'Zuia')) },
        ], r.owners),
        pager(st, r.total, load));
    });
  };
  const search = h('input', { placeholder: 'Tafuta jina au simu', onkeydown: (e) => { if (e.key === 'Enter') { st.q = e.target.value.trim(); st.offset = 0; load(); } } });
  box.append(h('div', { class: 'filters' },
    select([['', 'Hali zote'], ['pending', 'Wanaosubiri'], ['approved', 'Waliothibitishwa'], ['rejected', 'Waliokataliwa'], ['blocked', 'Waliozuiwa']], st.status, (v) => { st.status = v; st.offset = 0; load(); }),
    search), list);
  await load();
}

async function vehiclesPage(box) {
  const st = { status: 'pending', offset: 0 };
  const list = h('div');
  const load = async () => {
    await guard(async () => {
      const [r, o] = await Promise.all([
        api('GET', '/admin/vehicles' + qs({ approval_status: st.status, limit: PAGE, offset: st.offset })),
        api('GET', '/admin/owners?limit=200'),
      ]);
      const names = new Map(o.owners.map((x) => [x.id, x]));
      list.replaceChildren(
        table([
          { title: 'Aina', cell: (v) => label(v.type) },
          { title: 'Plate', cell: (v) => v.plate_no },
          { title: 'Mmiliki', cell: (v) => names.has(v.owner_id) ? `${names.get(v.owner_id).name} (${names.get(v.owner_id).phone})` : '-' },
          { title: 'Online', cell: (v) => (v.is_online ? 'Ndiyo' : 'Hapana') },
          { title: 'Hali', cell: (v) => chip(v.approval_status) },
          { title: 'Hatua', cell: (v) => h('div', { class: 'actions' },
            v.approval_status !== 'approved' && h('button', { class: 'small primary', onclick: () => setStatus(`/admin/vehicles/${v.id}/status`, 'approved', false, load) }, 'Thibitisha'),
            v.approval_status === 'pending' && h('button', { class: 'small', onclick: () => setStatus(`/admin/vehicles/${v.id}/status`, 'rejected', true, load) }, 'Kataa'),
            v.approval_status === 'approved' && h('button', { class: 'small danger', onclick: () => setStatus(`/admin/vehicles/${v.id}/status`, 'suspended', true, load) }, 'Simamisha')) },
        ], r.vehicles),
        pager(st, r.total, load));
    });
  };
  box.append(h('div', { class: 'filters' },
    select([['', 'Zote'], ['pending', 'Zinazosubiri'], ['approved', 'Zilizothibitishwa'], ['rejected', 'Zilizokataliwa'], ['suspended', 'Zilizosimamishwa']], st.status, (v) => { st.status = v; st.offset = 0; load(); })), list);
  await load();
}

async function invoicesPage(box) {
  const st = { period: nowPeriod(), status: '', offset: 0 };
  const list = h('div');
  const load = async () => {
    await guard(async () => {
      const r = await api('GET', '/admin/invoices' + qs({ period: st.period, status: st.status, limit: PAGE, offset: st.offset }));
      list.replaceChildren(
        table([
          { title: 'Mmiliki', cell: (i) => i.owner.name ? [i.owner.name, h('div', { class: 'muted' }, i.owner.phone)] : '-' },
          { title: 'Mwezi', cell: (i) => i.period },
          { title: 'Kiasi', cell: (i) => tzs(i.amount) },
          { title: 'Kimelipwa', cell: (i) => tzs(i.paid_amount) },
          { title: 'Control number', cell: (i) => i.control_number || '-' },
          { title: 'Mwisho', cell: (i) => i.due_date || '-' },
          { title: 'Hali', cell: (i) => chip(i.status) },
          { title: 'Hatua', cell: (i) => i.status !== 'paid' && i.control_number
            ? h('button', { class: 'small', title: 'Kwa majaribio tu', onclick: async () => {
              if (!window.confirm('Kuigiza malipo (majaribio tu) ya ankara hii?')) return;
              await guard(async () => { await api('POST', `/admin/invoices/${i.id}/mock-pay`, {}); toast('Malipo yameigizwa.'); await load(); });
            } }, 'Igiza malipo')
            : '' },
        ], r.invoices),
        pager(st, r.total, load));
    });
  };
  const period = h('input', { value: st.period, placeholder: 'YYYY-MM', onchange: (e) => { st.period = e.target.value.trim(); st.offset = 0; load(); } });
  box.append(h('div', { class: 'filters' }, period,
    select([['', 'Hali zote'], ['unpaid', 'Haijalipwa'], ['partial', 'Sehemu'], ['paid', 'Imelipwa'], ['expired', 'Imechelewa']], '', (v) => { st.status = v; st.offset = 0; load(); }),
    h('button', { onclick: () => guard(async () => {
      const r = await api('POST', '/admin/invoices/generate', st.period ? { period: st.period } : {});
      toast(`Ankara ${r.period}: mpya ${r.created}, zilizokuwepo ${r.existing}`);
      await load();
    }) }, 'Tengeneza ankara za mwezi')), list);
  await load();
}

async function passengersPage(box) {
  const st = { phone: '', offset: 0 };
  const list = h('div');
  const load = async () => {
    await guard(async () => {
      const r = await api('GET', '/admin/passengers' + qs({ phone: st.phone, limit: PAGE, offset: st.offset }));
      const act = (p, what) => guard(async () => {
        const reason = what === 'block' ? window.prompt('Sababu ya kumzuia (hiari):', '') : '';
        if (reason === null) return;
        await api('POST', `/admin/passengers/${p.id}/${what}`, reason ? { reason } : {});
        toast('Imehifadhiwa.');
        await load();
      });
      list.replaceChildren(
        table([
          { title: 'Jina', cell: (p) => p.name || '-' },
          { title: 'Simu', cell: (p) => p.phone || '-' },
          { title: 'Alianza', cell: (p) => dt(p.created_at) },
          { title: 'Hali', cell: (p) => chip(p.status) },
          { title: 'Hatua', cell: (p) => p.status === 'blocked'
            ? h('button', { class: 'small', onclick: () => act(p, 'unblock') }, 'Mruhusu')
            : h('button', { class: 'small danger', onclick: () => act(p, 'block') }, 'Mzuie') },
        ], r.passengers),
        pager(st, r.total, load));
    });
  };
  box.append(h('div', { class: 'filters' },
    h('input', { placeholder: 'Tafuta kwa simu (Enter)', onkeydown: (e) => { if (e.key === 'Enter') { st.phone = e.target.value.trim(); st.offset = 0; load(); } } })), list);
  await load();
}

async function settingsPage(box) {
  const s = await api('GET', '/admin/settings');
  const num = (v) => h('input', { type: 'number', min: 0, step: 1, value: v });
  const field = (t, input) => h('div', {}, h('label', {}, t), input);
  const intOf = (el) => Number.parseInt(el.value, 10);

  const rateInputs = s.fare_rates.map((r) => ({
    type: r.vehicle_type, base: num(r.base_fare), km: num(r.per_km), min: num(r.min_fare),
  }));
  const fee = num(s.owner_fee.amount);
  const due = num(s.owner_fee.due_day);
  const g = {
    search_radius_km: num(s.general.search_radius_km), request_timeout_sec: num(s.general.request_timeout_sec),
    max_trip_km: num(s.general.max_trip_km), max_rides_per_hour: num(s.general.max_rides_per_hour),
  };

  box.append(
    h('div', { class: 'panel' }, h('h3', {}, 'Bei za nauli'),
      h('p', { class: 'muted' }, 'Nauli = msingi + (km x bei kwa km), isiwe chini ya nauli ya chini.'),
      rateInputs.map((r) => h('div', { style: 'margin-bottom:12px' }, h('strong', {}, label(r.type)),
        h('div', { class: 'grid2' }, field('Msingi (TZS)', r.base), field('Kwa km (TZS)', r.km), field('Chini kabisa (TZS)', r.min)))),
      h('button', { class: 'primary', onclick: () => guard(async () => {
        await api('PUT', '/admin/settings/fare-rates', { rates: rateInputs.map((r) => ({ vehicle_type: r.type, base_fare: intOf(r.base), per_km: intOf(r.km), min_fare: intOf(r.min) })) });
        toast('Bei zimehifadhiwa.');
      }) }, 'Hifadhi bei')),
    h('div', { class: 'panel' }, h('h3', {}, 'Ada ya mwezi ya mmiliki'),
      h('p', { class: 'muted' }, 'Inahusu ankara mpya tu; zilizokwisha tengenezwa hazibadiliki.'),
      h('div', { class: 'grid2' }, field('Kiasi (TZS)', fee), field('Siku ya mwisho ya kulipa (1-28)', due)),
      h('div', { style: 'margin-top:12px' }, h('button', { class: 'primary', onclick: () => guard(async () => {
        await api('PUT', '/admin/settings/owner-fee', { amount: intOf(fee), due_day: intOf(due) });
        toast('Ada imehifadhiwa.');
      }) }, 'Hifadhi ada'))),
    h('div', { class: 'panel' }, h('h3', {}, 'Mipangilio ya jumla'),
      h('div', { class: 'grid2' },
        field('Radius ya kutafuta (km)', g.search_radius_km), field('Muda wa ombi kujibiwa (sekunde)', g.request_timeout_sec),
        field('Umbali mkubwa wa safari (km)', g.max_trip_km), field('Maombi kwa saa kwa abiria', g.max_rides_per_hour)),
      h('div', { style: 'margin-top:12px' }, h('button', { class: 'primary', onclick: () => guard(async () => {
        const body = {};
        for (const [k, el] of Object.entries(g)) body[k] = intOf(el);
        await api('PUT', '/admin/settings/general', body);
        toast('Mipangilio imehifadhiwa.');
      }) }, 'Hifadhi'))));
}

const PAGES = { summary: summaryPage, rides: ridesPage, owners: ownersPage, vehicles: vehiclesPage, invoices: invoicesPage, passengers: passengersPage, settings: settingsPage };

async function showTab(box) {
  box.replaceChildren(h('h2', {}, TABS.find((t) => t[0] === currentTab)[1]));
  await guard(() => PAGES[currentTab](box));
}

function render() {
  const app = document.getElementById('app');
  if (!token) { app.replaceChildren(loginView()); return; }
  const box = h('main');
  const tabs = h('nav', { class: 'tabs' });
  const paint = () => {
    tabs.replaceChildren(...TABS.map(([k, t]) => h('button', { class: k === currentTab ? 'active' : '', onclick: () => { currentTab = k; paint(); showTab(box); } }, t)));
  };
  paint();
  app.replaceChildren(
    h('header', { class: 'top' }, h('div', { class: 'grow' }, 'Usafiri - Admin'),
      h('span', { class: 'muted' }, adminInfo ? `${adminInfo.name || ''} (${adminInfo.role})` : ''),
      h('button', { onclick: logout }, 'Toka')),
    tabs, box);
  showTab(box);
}

render();
