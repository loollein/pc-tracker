// ==================== Утилиты API ====================
async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  let body = null;
  const text = await res.text();
  if (text) { try { body = JSON.parse(text); } catch (e) { body = null; } }
  if (!res.ok) {
    const message = (body && body.error) || `Ошибка запроса (${res.status})`;
    throw new Error(message);
  }
  return body;
}

const STATUS_LABELS = {
  working: 'Работает',
  repair: 'На ремонте',
  decommissioned: 'Списан',
};

const TYPE_LABELS = {
  pc: 'ПК',
  printer: 'Принтер',
  mfu: 'МФУ',
  network: 'Сетевые устройства',
  spm: 'СПМ',
  sempl: 'другое'
};

const DEFAULT_OS_OPTIONS = [
  'Astra Linux',
  'Red OS',
  'ALT Linux',
  'Win 7',
  'Win 10',
  'другое'
];

// Пороги в днях для "Зависшего ремонта" и "Призраков"
const STUCK_REPAIR_DAYS = 14;
const GHOST_OFFLINE_DAYS = 30;

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function cleanInvNumber(inv) {
  return String(inv ?? '').replace(/#trash_\d+$/, '');
}

function pluralizeRu(count, [one, few, many]) {
  const n = Math.abs(count) % 100;
  const n1 = n % 10;
  if (n > 10 && n < 20) return many;
  if (n1 > 1 && n1 < 5) return few;
  if (n1 === 1) return one;
  return many;
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso.replace(' ', 'T') + (iso.endsWith('Z') ? '' : 'Z'));
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function daysSince(iso) {
  if (!iso) return null;
  const d = new Date(iso.replace(' ', 'T') + (iso.endsWith('Z') ? '' : 'Z'));
  if (Number.isNaN(d.getTime())) return null;
  const diffMs = Date.now() - d.getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

function getRepairDays(device) {
  if (!device || device.status !== 'repair') return 0;
  return daysSince(device.updated_at || device.created_at) ?? 0;
}

function isStuckRepair(device) {
  return device?.status === 'repair' && getRepairDays(device) >= STUCK_REPAIR_DAYS;
}

function getOfflineDays(device) {
  if (!device || device.is_online) return 0;
  const refDate = device.last_seen || device.created_at;
  return daysSince(refDate) ?? 0;
}

function isGhostDevice(device) {
  if (!device || device.status !== 'working') return false;
  if (!device.ip_address || device.is_online) return false;
  return getOfflineDays(device) >= GHOST_OFFLINE_DAYS;
}

function isLinuxOs(osName) {
  if (!osName) return false;
  return /(astra|red\s*os|ред\s*ос|alt|альт|linux|ubuntu|debian|fedora|роса|rosa)/i.test(osName);
}

function statusBadge(status, device = null) {
  if (status === 'repair' && device) {
    const days = getRepairDays(device);
    if (days >= STUCK_REPAIR_DAYS) {
      return `<span class="badge repair" title="Зависший ремонт: ${days} дн. без изменений" style="background:#dc2626; color:#fff; font-weight:600;">🔥 На ремонте (${days} дн.)</span>`;
    }
    if (days > 0) {
      return `<span class="badge repair" title="В ремонте ${days} дн.">На ремонте (${days} дн.)</span>`;
    }
  }
  return `<span class="badge ${status}">${STATUS_LABELS[status] || status}</span>`;
}

// Универсальная функция выгрузки произвольного массива устройств в Excel (используется и в Экспорте, и во вкладке Филиалы)
async function exportDevicesToExcelFile(devicesToExport, filenamePrefix = 'Выгрузка_Техники') {
  if (!devicesToExport || devicesToExport.length === 0) {
    alert('В выбранном списке нет устройств для выгрузки.');
    return;
  }

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Устройства');

  const headers = [
    'Муниципальный филиал',
    'Населённый пункт',
    'Тип',
    'Инвентарный номер',
    'Название',
    'IP-адрес',
    'ОС',
    'Софт',
    'СЗИ',
    'Ввод в домен',
    'Примечание',
    'Статус'
  ];

  const headerRow = worksheet.addRow(headers);
  headerRow.font = { bold: true };
  headerRow.alignment = { horizontal: 'center', vertical: 'middle' };

  devicesToExport.forEach(d => {
    const row = worksheet.addRow([
      d.branch_name || '',
      d.settlement_name || '',
      TYPE_LABELS[d.type] || d.type,
      cleanInvNumber(d.inventory_number),
      d.name,
      d.ip_address || '',
      d.os || '',
      d.software || '',
      d.security || '',
      d.domain_joined || '',
      d.notes || '',
      STATUS_LABELS[d.status] || d.status,
    ]);
    row.alignment = { vertical: 'middle', wrapText: true };
    row.getCell(7).alignment = { vertical: 'middle', wrapText: true };
  });

  worksheet.columns.forEach((col) => {
    let maxLength = 0;
    col.eachCell({ includeEmpty: true }, (cell) => {
      const value = cell.value ? cell.value.toString() : '';
      maxLength = Math.max(maxLength, value.length);
    });
    col.width = Math.min(50, Math.max(12, maxLength + 2));
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const safePrefix = String(filenamePrefix).replace(/[\\/:*?"<>|]+/g, '_');
  const fname = `${safePrefix}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  saveAs(blob, fname);
}

// Формирует мини-бейджи разбивки по типам техники ("💻 ПК: 8 | 🖨️ Принт: 2...")
function renderTypeBreakdownPills(devicesList) {
  if (!devicesList || devicesList.length === 0) return '';
  const counts = { pc: 0, printer: 0, mfu: 0, network: 0, spm: 0, sempl: 0 };
  for (const d of devicesList) {
    if (counts[d.type] !== undefined) counts[d.type]++;
  }

  const meta = [
    { key: 'pc', icon: '💻', label: 'ПК' },
    { key: 'printer', icon: '🖨️', label: 'Принт' },
    { key: 'mfu', icon: '📠', label: 'МФУ' },
    { key: 'network', icon: '🌐', label: 'Сеть' },
    { key: 'spm', icon: '⚙️', label: 'СПМ' },
    { key: 'sempl', icon: '📦', label: 'Др' }
  ];

  const pills = meta
    .filter(m => counts[m.key] > 0)
    .map(m => `<span style="display:inline-block; background:var(--bg-alt, #f1f5f9); border:1px solid var(--line, #e2e8f0); border-radius:4px; padding:1px 6px; font-size:11.5px; color:var(--ink);">${m.icon} ${m.label}: <b>${counts[m.key]}</b></span>`);

  return pills.join(' ');
}

// Формирует индикатор сетевого здоровья ("🟢 12/15 в сети" или "🚨 0/8 нет связи")
function renderNetworkHealthPill(devicesList, anyEverScanned) {
  const withIp = (devicesList || []).filter(d => d.ip_address && d.status !== 'decommissioned');
  if (withIp.length === 0) {
    return `<span style="font-size:11.5px; color:var(--ink-dim);">без IP</span>`;
  }
  const online = withIp.filter(d => d.is_online).length;
  if (online === 0 && anyEverScanned && withIp.length >= 2) {
    return `<span title="Все устройства с IP в этом пункте сейчас не отвечают на пинг" style="display:inline-block; background:#fef2f2; border:1px solid #f87171; color:#dc2626; border-radius:4px; padding:1px 6px; font-size:11.5px; font-weight:600;">🚨 0/${withIp.length} (нет связи)</span>`;
  }
  const color = online > 0 ? '#1a8f4c' : '#64748b';
  const dot = online > 0 ? '🟢' : '⚪';
  return `<span title="Онлайн ${online} из ${withIp.length} устройств с IP-адресами" style="display:inline-block; background:#f8fafc; border:1px solid #cbd5e1; color:${color}; border-radius:4px; padding:1px 6px; font-size:11.5px; font-weight:500;">${dot} ${online}/${withIp.length} в сети</span>`;
}

async function fetchOsOptions() {
  try {
    const dbOs = await api('/api/devices/os-list');
    return Array.from(new Set([...DEFAULT_OS_OPTIONS, ...(dbOs || [])]));
  } catch (e) {
    return DEFAULT_OS_OPTIONS;
  }
}

function populateSettlementSelect(selectEl, settlements, selectedBranchId, currentSettlementId = '', defaultLabel = 'Все нас. пункты') {
  const filtered = selectedBranchId
    ? settlements.filter(s => String(s.municipal_branch_id) === String(selectedBranchId))
    : settlements;

  const isStillValid = filtered.some(s => String(s.id) === String(currentSettlementId));
  const finalValue = isStillValid ? String(currentSettlementId) : '';

  selectEl.innerHTML = `<option value="">${escapeHtml(defaultLabel)}</option>` +
    filtered.map(s => `<option value="${s.id}" ${String(s.id) === finalValue ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('');

  selectEl.value = finalValue;
}

function enableTableSorting(tableEl) {
  if (!tableEl) return;
  const headers = tableEl.querySelectorAll('th[data-sort-col]');
  headers.forEach(th => {
    th.style.cursor = 'pointer';
    th.style.userSelect = 'none';
    th.title = 'Нажмите для сортировки';
    th.addEventListener('click', () => {
      const colIdx = Number(th.dataset.sortCol);
      const type = th.dataset.sortType || 'num';
      const tbody = tableEl.querySelector('tbody');
      const rows = Array.from(tbody.querySelectorAll('tr'));
      const asc = th.dataset.sortDir === 'asc' ? false : true;

      headers.forEach(h => {
        h.dataset.sortDir = '';
        h.textContent = h.textContent.replace(/ [▲▼]$/, '');
      });
      th.dataset.sortDir = asc ? 'asc' : 'desc';
      th.textContent += asc ? ' ▲' : ' ▼';

      rows.sort((a, b) => {
        const aText = (a.children[colIdx]?.dataset.sortVal ?? a.children[colIdx]?.textContent ?? '').trim();
        const bText = (b.children[colIdx]?.dataset.sortVal ?? b.children[colIdx]?.textContent ?? '').trim();
        if (type === 'str') {
          return asc ? aText.localeCompare(bText, 'ru') : bText.localeCompare(aText, 'ru');
        }
        const aNum = parseFloat(aText) || 0;
        const bNum = parseFloat(bText) || 0;
        return asc ? aNum - bNum : bNum - aNum;
      });

      rows.forEach(r => tbody.appendChild(r));
    });
  });
}

const view = document.getElementById('view');
const modalRoot = document.getElementById('modalRoot');

function closeModal() { modalRoot.innerHTML = ''; }

function openModal(title, fieldsHtml, onSubmit, submitLabel = 'Сохранить') {
  modalRoot.innerHTML = `
    <div class="overlay" id="overlay">
      <div class="modal">
        <h3>${escapeHtml(title)}</h3>
        <form id="modalForm">
          ${fieldsHtml}
          <div class="error-text hidden" id="modalError"></div>
          <div class="modal-actions">
            <button type="button" class="btn" id="modalCancel">Отмена</button>
            <button type="submit" class="btn primary">${escapeHtml(submitLabel)}</button>
          </div>
        </form>
      </div>
    </div>
  `;
  document.getElementById('modalCancel').onclick = closeModal;
  document.getElementById('overlay').addEventListener('click', (e) => {
    if (e.target.id === 'overlay') closeModal();
  });
  document.getElementById('modalForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('modalError');
    errorEl.classList.add('hidden');
    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData.entries());
    try {
      const result = await onSubmit(data);
      if (result !== false) closeModal();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
    }
  });
}

// ==================== Баннер "на ремонте" и счетчики ====================
async function loadRepairBanner() {
  try {
    const devices = await api('/api/devices?status=repair');
    const banner = document.getElementById('repairBanner');
    if (devices.length === 0) { banner.classList.add('hidden'); return; }
    banner.classList.remove('hidden');

    const stuckCount = devices.filter(isStuckRepair).length;
    const word = pluralizeRu(devices.length, ['устройство', 'устройства', 'устройств']);

    let stuckHtml = '';
    if (stuckCount > 0) {
      stuckHtml = ` <span style="margin-left:10px; padding:2px 8px; background:#dc2626; color:#fff; border-radius:4px; font-size:12px;">
        🔥 Из них ${stuckCount} зависли &gt; ${STUCK_REPAIR_DAYS} дн. <a href="#/devices?alert=stuck_repair" style="color:#fff; text-decoration:underline; margin-left:4px;">Показать</a>
      </span>`;
    }

    banner.innerHTML = `⚠️ <strong>${devices.length}</strong> ${word} сейчас на ремонте.
      <a href="#/devices?status=repair">Посмотреть все →</a>${stuckHtml}`;
  } catch (e) { /* игнор */ }
}

async function loadSidebarTotal() {
  try {
    const [data, trash] = await Promise.all([
      api('/api/dashboard'),
      api('/api/devices/trash')
    ]);
    document.getElementById('sidebarTotal').textContent = data.totals.total_devices || 0;
    const trashBadge = document.getElementById('trashBadge');
    if (trashBadge) {
      trashBadge.textContent = trash.length > 0 ? `(${trash.length})` : '';
    }
  } catch (e) { /* игнор */ }
}

// ==================== Роутинг ====================
function parseHash() {
  const hash = location.hash.replace(/^#/, '') || '/dashboard';
  const [pathPart, queryPart] = hash.split('?');
  const segments = pathPart.split('/').filter(Boolean);
  const query = Object.fromEntries(new URLSearchParams(queryPart || ''));
  return { segments, query };
}

async function router() {
  const { segments, query } = parseHash();
  document.querySelectorAll('.nav-link').forEach((a) => a.classList.remove('active'));

  try {
    if (segments[0] === 'dashboard' || segments.length === 0) {
      setActiveNav('dashboard');
      await renderDashboard();
    } else if (segments[0] === 'branches' && segments.length === 1) {
      setActiveNav('branches');
      await renderBranchesList();
    } else if (segments[0] === 'branches' && segments.length === 2) {
      setActiveNav('branches');
      await renderSettlementsList(segments[1]);
    } else if (segments[0] === 'branches' && segments.length === 4 && segments[2] === 'settlements') {
      setActiveNav('branches');
      await renderDevicesOfSettlement(segments[1], segments[3]);
    } else if (segments[0] === 'devices') {
      setActiveNav('devices');
      await renderAllDevices(query);
    } else if (segments[0] === 'export') {
      setActiveNav('export');
      await renderExport();
    } else if (segments[0] === 'history') {
      setActiveNav('history');
      await renderHistoryPage();
    } else if (segments[0] === 'trash') {
      setActiveNav('trash');
      await renderTrash();
    } else {
      view.innerHTML = '<div class="empty-state">Страница не найдена.</div>';
    }
  } catch (err) {
    view.innerHTML = `<div class="panel"><p class="error-text">${escapeHtml(err.message)}</p></div>`;
  }

  loadRepairBanner();
  loadSidebarTotal();
}

function setActiveNav(route) {
  const link = document.querySelector(`.nav-link[data-route="${route}"]`);
  if (link) link.classList.add('active');
}
window.addEventListener('hashchange', router);
window.addEventListener('DOMContentLoaded', router);

// ==================== ДАШБОРД ====================
async function renderDashboard() {
  view.innerHTML = '<div class="empty-state">Загрузка…</div>';
  const [data, allDevices, recentHistory] = await Promise.all([
    api('/api/dashboard'),
    api('/api/devices'),
    api('/api/history?limit=6').catch(() => [])
  ]);
  const t = data.totals;

  const stuckRepairs = allDevices
    .filter(isStuckRepair)
    .sort((a, b) => getRepairDays(b) - getRepairDays(a));

  const ghostDevices = allDevices
    .filter(isGhostDevice)
    .sort((a, b) => getOfflineDays(b) - getOfflineDays(a));

  const devicesWithIp = allDevices.filter(d => d.ip_address && d.status !== 'decommissioned');
  const onlineDevices = devicesWithIp.filter(d => d.is_online);
  const onlinePercent = devicesWithIp.length > 0 ? Math.round((onlineDevices.length / devicesWithIp.length) * 100) : 0;

  const branchOnlineMap = {};
  const settlementOnlineMap = {};
  const settlementHasIpMap = {};

  for (const d of allDevices) {
    if (d.ip_address && d.status !== 'decommissioned') {
      settlementHasIpMap[d.settlement_branch_id] = (settlementHasIpMap[d.settlement_branch_id] || 0) + 1;
    }
    if (d.is_online) {
      branchOnlineMap[d.municipal_branch_id] = (branchOnlineMap[d.municipal_branch_id] || 0) + 1;
      settlementOnlineMap[d.settlement_branch_id] = (settlementOnlineMap[d.settlement_branch_id] || 0) + 1;
    }
  }

  const anyEverScanned = allDevices.some(d => d.last_seen);
  const offlineSettlements = anyEverScanned
    ? (data.bySettlement || []).filter(s => (settlementHasIpMap[s.id] || 0) >= 2 && (settlementOnlineMap[s.id] || 0) === 0)
    : [];

  const workingPcs = allDevices.filter(d => d.type === 'pc' && d.status === 'working');
  const totalWorkingPcs = workingPcs.length || 1;

  const domainJoinedPcs = workingPcs.filter(d => d.domain_joined === 'Да');
  const withSecurityPcs = workingPcs.filter(d => d.security && d.security.trim() !== '');
  const linuxPcs = workingPcs.filter(d => isLinuxOs(d.os));
  const noOsPcs = workingPcs.filter(d => !d.os || d.os.trim() === '');

  const domainPct = workingPcs.length ? Math.round((domainJoinedPcs.length / totalWorkingPcs) * 100) : 0;
  const securityPct = workingPcs.length ? Math.round((withSecurityPcs.length / totalWorkingPcs) * 100) : 0;
  const linuxPct = workingPcs.length ? Math.round((linuxPcs.length / totalWorkingPcs) * 100) : 0;

  const cardStyle = 'text-decoration:none; color:inherit; cursor:pointer; transition:transform 0.12s, box-shadow 0.12s; display:block;';

  view.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Дашборд</h1>
        <p class="subtitle">Оперативная сводка, сетевой мониторинг и контроль безопасности</p>
      </div>
      <div style="display:flex; gap:8px;">
        <button class="btn primary" id="dashScanBtn">📡 Пропинговать подсети</button>
      </div>
    </div>

    <div class="stat-grid">
      <a href="#/devices" class="stat-card" style="${cardStyle}" title="Показать все устройства">
        <div class="num">${t.total_devices || 0}</div><div class="label">Всего устройств</div>
      </a>
      <a href="#/devices?type=pc" class="stat-card" style="${cardStyle}" title="Фильтр: только ПК">
        <div class="num">${t.total_pc || 0}</div><div class="label">ПК</div>
      </a>
      <a href="#/devices?type=printer" class="stat-card" style="${cardStyle}" title="Фильтр: только Принтеры">
        <div class="num">${t.total_printers || 0}</div><div class="label">Принтеры</div>
      </a>
      <a href="#/devices?type=mfu" class="stat-card" style="${cardStyle}" title="Фильтр: только МФУ">
        <div class="num">${t.total_mfu || 0}</div><div class="label">МФУ</div>
      </a>
      <a href="#/devices?type=network" class="stat-card" style="${cardStyle}" title="Фильтр: Сетевые устройства">
        <div class="num">${t.total_network || 0}</div><div class="label">Сетевые устройства</div>
      </a>
      <a href="#/devices?type=spm" class="stat-card" style="${cardStyle}" title="Фильтр: СПМ">
        <div class="num">${t.total_spm || 0}</div><div class="label">СПМ</div>
      </a>
      <a href="#/devices?type=sempl" class="stat-card" style="${cardStyle}" title="Фильтр: другое">
        <div class="num">${t.total_sempl || 0}</div><div class="label">другое</div>
      </a>
      <a href="#/devices?status=working" class="stat-card ok" style="${cardStyle}" title="Фильтр: Работают">
        <div class="num">${t.total_working || 0}</div><div class="label">Работают</div>
      </a>
      <a href="#/devices?status=repair" class="stat-card warn" style="${cardStyle}" title="Фильтр: На ремонте">
        <div class="num">${t.total_repair || 0}</div><div class="label">На ремонте</div>
      </a>
      <a href="#/devices?status=decommissioned" class="stat-card off" style="${cardStyle}" title="Фильтр: Списаны">
        <div class="num">${t.total_decommissioned || 0}</div><div class="label">Списаны</div>
      </a>
    </div>

    <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(290px, 1fr)); gap:20px; margin-bottom: 20px;">
      
      <div class="panel" style="border-left: 4px solid ${offlineSettlements.length > 0 ? '#f59e0b' : '#1a8f4c'}; margin-bottom:0;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
          <h3 style="margin:0; font-size:16px;">📡 Сетевой пульс</h3>
          <a href="#/devices?alert=online" class="btn small" style="color:#1a8f4c; font-weight:600;">🟢 ${onlineDevices.length} в сети →</a>
        </div>
        <div style="font-size:13px; color:var(--ink-dim); margin-bottom:8px;">
          Отвечают на пинг <strong>${onlineDevices.length}</strong> из <strong>${devicesWithIp.length}</strong> устр. с IP (${onlinePercent}%)
        </div>
        <div style="height:8px; background:#e2e8f0; border-radius:4px; overflow:hidden; margin-bottom:12px;">
          <div style="width:${onlinePercent}%; height:100%; background:#1a8f4c;"></div>
        </div>
        ${offlineSettlements.length > 0 ? `
          <div style="background:#fef3c7; border:1px solid #f59e0b; border-radius:6px; padding:8px; font-size:12px; color:#92400e;">
            <strong>🚨 Нет связи с пунктами (0 онлайн):</strong>
            <div style="margin-top:4px; max-height:60px; overflow-y:auto;">
              ${offlineSettlements.map(s => `<a href="#/branches/${s.municipal_branch_id}/settlements/${s.id}" style="color:#92400e; text-decoration:underline; margin-right:8px;">${escapeHtml(s.name)}</a>`).join('')}
            </div>
          </div>
        ` : `<div style="font-size:12.5px; color:#1a8f4c;">✅ Все активные подсети на связи</div>`}
      </div>

      <div class="panel" style="border-left: 4px solid ${stuckRepairs.length > 0 ? '#dc2626' : '#1a8f4c'}; margin-bottom:0;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
          <h3 style="margin:0; font-size:16px;">🔥 Зависший ремонт (&gt; ${STUCK_REPAIR_DAYS} дн.)</h3>
          <a href="#/devices?alert=stuck_repair" class="btn small">${stuckRepairs.length} шт. →</a>
        </div>
        ${stuckRepairs.length === 0
          ? '<div style="color:var(--ink-dim); font-size:13px;">Нет устройств, зависших в ремонте дольше 14 дней 👍</div>'
          : `<div style="max-height:110px; overflow-y:auto; font-size:13px;">
              ${stuckRepairs.slice(0, 5).map(d => `
                <div style="display:flex; justify-content:space-between; padding:4px 0; border-bottom:1px solid var(--line);">
                  <span><strong>${escapeHtml(d.name)}</strong> <span style="color:var(--ink-dim);">(${escapeHtml(d.settlement_name)})</span></span>
                  <span style="color:#dc2626; font-weight:600; white-space:nowrap;">${getRepairDays(d)} дн.</span>
                </div>
              `).join('')}
            </div>`
        }
      </div>

      <div class="panel" style="border-left: 4px solid ${ghostDevices.length > 0 ? '#6366f1' : '#1a8f4c'}; margin-bottom:0;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
          <h3 style="margin:0; font-size:16px;">👻 «Призраки» (офлайн &gt; ${GHOST_OFFLINE_DAYS} дн.)</h3>
          <a href="#/devices?alert=ghosts" class="btn small">${ghostDevices.length} шт. →</a>
        </div>
        ${ghostDevices.length === 0
          ? '<div style="color:var(--ink-dim); font-size:13px;">Все рабочие устройства с IP выходили на связь в последние 30 дней 👍</div>'
          : `<div style="max-height:110px; overflow-y:auto; font-size:13px;">
              ${ghostDevices.slice(0, 5).map(d => `
                <div style="display:flex; justify-content:space-between; padding:4px 0; border-bottom:1px solid var(--line);">
                  <span><strong>${escapeHtml(d.name)}</strong> <code style="font-size:11px;">${escapeHtml(d.ip_address)}</code></span>
                  <span style="color:#6366f1; font-weight:600; white-space:nowrap;">${getOfflineDays(d)} дн.</span>
                </div>
              `).join('')}
            </div>`
        }
      </div>

    </div>

    <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap:20px; margin-bottom: 20px;">
      
      <div class="panel" style="margin-bottom:0;">
        <h3 style="margin-top:0; font-size:16px;">🛡️ Безопасность и импортозамещение (рабочие ПК: ${workingPcs.length})</h3>
        
        <div style="margin-bottom:10px;">
          <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:3px;">
            <span>Введены в домен</span>
            <strong>${domainJoinedPcs.length} из ${workingPcs.length} (${domainPct}%)</strong>
          </div>
          <div style="height:7px; background:#e2e8f0; border-radius:4px; overflow:hidden;">
            <div style="width:${domainPct}%; height:100%; background:#0284c7;"></div>
          </div>
        </div>

        <div style="margin-bottom:10px;">
          <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:3px;">
            <span>Установлены СЗИ</span>
            <strong>${withSecurityPcs.length} из ${workingPcs.length} (${securityPct}%)</strong>
          </div>
          <div style="height:7px; background:#e2e8f0; border-radius:4px; overflow:hidden;">
            <div style="width:${securityPct}%; height:100%; background:#1a8f4c;"></div>
          </div>
        </div>

        <div style="margin-bottom:12px;">
          <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:3px;">
            <span>Отечественные ОС / Linux</span>
            <strong>${linuxPcs.length} из ${workingPcs.length} (${linuxPct}%)</strong>
          </div>
          <div style="height:7px; background:#e2e8f0; border-radius:4px; overflow:hidden;">
            <div style="width:${linuxPct}%; height:100%; background:#7c3aed;"></div>
          </div>
        </div>

        <div style="display:flex; flex-wrap:wrap; gap:6px; padding-top:6px; border-top:1px solid var(--line);">
          <a href="#/devices?type=pc&alert=no_domain" class="btn small">ПК вне домена (${workingPcs.length - domainJoinedPcs.length})</a>
          <a href="#/devices?type=pc&alert=no_szi" class="btn small">ПК без СЗИ (${workingPcs.length - withSecurityPcs.length})</a>
          ${noOsPcs.length > 0 ? `<a href="#/devices?type=pc&alert=no_os" class="btn small">Без ОС (${noOsPcs.length})</a>` : ''}
        </div>
      </div>

      <div class="panel" style="margin-bottom:0; display:flex; flex-direction:column; justify-content:space-between;">
        <div style="display:flex; align-items:center; gap:18px; margin-bottom:14px;">
          <div style="width:105px; height:105px; flex-shrink:0;">
            <canvas id="statusChart" width="220" height="220"></canvas>
          </div>
          <div style="flex:1;">
            <h3 style="margin:0 0 8px 0; font-size:16px;">Статусы и ОС</h3>
            <ul style="list-style:none; padding:0; margin:0; font-size:13px;">
              <li style="margin-bottom: 3px;"><span style="display:inline-block; width:10px; height:10px; background:#1a8f4c; border-radius:50%; margin-right:6px;"></span> Работает: <strong>${t.total_working}</strong></li>
              <li style="margin-bottom: 3px;"><span style="display:inline-block; width:10px; height:10px; background:#b8730a; border-radius:50%; margin-right:6px;"></span> На ремонте: <strong>${t.total_repair}</strong></li>
              <li><span style="display:inline-block; width:10px; height:10px; background:#6b7488; border-radius:50%; margin-right:6px;"></span> Списан: <strong>${t.total_decommissioned}</strong></li>
            </ul>
          </div>
        </div>
        <div style="font-size:13px; max-height: 115px; overflow-y: auto; border-top:1px solid var(--line); padding-top:8px;">
          ${data.osStats.map(o => `
            <a href="#/devices?os=${encodeURIComponent(o.os_name)}" style="display:flex; justify-content:space-between; align-items:center; padding:4px 0; border-bottom:1px dashed var(--line); text-decoration:none; color:inherit;">
              <span><span style="display:inline-block; width:7px; height:7px; background:var(--primary); border-radius:50%; margin-right:6px;"></span>${escapeHtml(o.os_name)}</span>
              <strong>${o.count}</strong>
            </a>
          `).join('') || '<div style="color:var(--ink-dim); font-size:12px;">Нет данных об ОС</div>'}
        </div>
      </div>

      <div class="panel" style="margin-bottom:0;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
          <h3 style="margin:0; font-size:16px;">📜 Последние события</h3>
          <a href="#/history" class="btn small">Весь журнал →</a>
        </div>
        ${(!recentHistory || recentHistory.length === 0)
          ? '<div style="color:var(--ink-dim); font-size:13px;">Событий пока нет</div>'
          : `<div style="max-height:195px; overflow-y:auto; font-size:12.5px;">
              ${recentHistory.map(h => `
                <div style="padding:5px 0; border-bottom:1px solid var(--line);">
                  <div style="display:flex; justify-content:space-between; color:var(--ink-dim); font-size:11px;">
                    <span><strong>${escapeHtml(h.device_name)}</strong></span>
                    <span>${fmtDate(h.created_at)}</span>
                  </div>
                  <div style="margin-top:2px;">${escapeHtml(h.description)}</div>
                </div>
              `).join('')}
            </div>`
        }
      </div>

    </div>

    <div class="panel">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <h2 style="margin:0;">По муниципальным филиалам</h2>
        <span style="font-size:12px; color:var(--ink-dim);">Нажмите на заголовок колонки для сортировки</span>
      </div>
      ${renderBranchStatsTable(data.byMunicipalBranch, branchOnlineMap)}
    </div>

    <div class="panel">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:12px;">
        <h2 style="margin:0;">По населённым пунктам</h2>
        <input type="text" id="dashSettlementSearch" placeholder="Быстрый фильтр по пункту или филиалу..." style="max-width:320px; width:100%;">
      </div>
      ${renderSettlementStatsTable(data.bySettlement, settlementOnlineMap)}
    </div>
  `;

  const dashScanBtn = document.getElementById('dashScanBtn');
  if (dashScanBtn) {
    dashScanBtn.onclick = async () => {
      dashScanBtn.disabled = true;
      dashScanBtn.textContent = '⏳ Сканируем подсети...';
      try {
        const res = await api('/api/scan', { method: 'POST' });
        alert(
          `Сканирование завершено!\n` +
          `Проверено IP: ${res.scannedIps}\n` +
          `Сейчас онлайн: ${res.onlineCount}\n` +
          `Новых устройств: ${res.autoCreated}\n` +
          `Авто-перемещено: ${res.autoMoved}`
        );
        await renderDashboard();
        loadSidebarTotal();
      } catch (err) {
        alert('Ошибка сканирования: ' + err.message);
      } finally {
        dashScanBtn.disabled = false;
        dashScanBtn.textContent = '📡 Пропинговать подсети';
      }
    };
  }

  enableTableSorting(document.getElementById('dashBranchesTable'));
  enableTableSorting(document.getElementById('dashSettlementsTable'));

  const settlementSearch = document.getElementById('dashSettlementSearch');
  if (settlementSearch) {
    settlementSearch.oninput = (e) => {
      const q = e.target.value.trim().toLowerCase();
      document.querySelectorAll('#dashSettlementsTable tbody tr').forEach(tr => {
        tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
    };
  }

  const ctx = document.getElementById('statusChart');
  if (ctx) {
    if (window.statusChartInstance) {
      window.statusChartInstance.destroy();
    }
    window.statusChartInstance = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Работает', 'На ремонте', 'Списан'],
        datasets: [{
          data: [t.total_working || 0, t.total_repair || 0, t.total_decommissioned || 0],
          backgroundColor: ['#1a8f4c', '#b8730a', '#6b7488'],
          borderWidth: 2,
          borderColor: '#ffffff',
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false }
        },
        cutout: '65%',
      }
    });
  }
}

function renderBranchStatsTable(branches, branchOnlineMap = {}) {
  if (!branches || branches.length === 0) {
    return '<div class="empty-state">Нет данных по филиалам</div>';
  }
  return `
    <div class="table-container" style="overflow-x: auto;">
      <table class="table" id="dashBranchesTable" style="width:100%; border-collapse: collapse;">
        <thead>
          <tr>
            <th data-sort-col="0" data-sort-type="str" style="text-align:left; padding: 10px;">Филиал</th>
            <th data-sort-col="1" style="padding: 10px;">Всего</th>
            <th data-sort-col="2" style="padding: 10px;">🟢 В сети</th>
            <th data-sort-col="3" style="padding: 10px;">ПК</th>
            <th data-sort-col="4" style="padding: 10px;">Принтеры</th>
            <th data-sort-col="5" style="padding: 10px;">МФУ</th>
            <th data-sort-col="6" style="padding: 10px;">Сеть</th>
            <th data-sort-col="7" style="padding: 10px;">СПМ</th>
            <th data-sort-col="8" style="padding: 10px;">другое</th>
            <th data-sort-col="9" style="padding: 10px;">Работают</th>
            <th data-sort-col="10" style="padding: 10px;">Ремонт</th>
            <th data-sort-col="11" style="padding: 10px;">Списаны</th>
          </tr>
        </thead>
        <tbody>
          ${branches.map(b => {
            const online = branchOnlineMap[b.id] || 0;
            return `
              <tr class="clickable" onclick="location.hash='#/branches/${b.id}'" style="border-bottom: 1px solid var(--line); cursor: pointer;">
                <td style="padding: 8px; font-weight: 500;">${escapeHtml(b.name)}</td>
                <td style="padding: 8px; text-align: center; font-weight: 600;">${b.devices_count || 0}</td>
                <td style="padding: 8px; text-align: center; color: ${online > 0 ? '#1a8f4c' : 'var(--ink-dim)'}; font-weight: 600;">${online}</td>
                <td style="padding: 8px; text-align: center;">${b.pc_count || 0}</td>
                <td style="padding: 8px; text-align: center;">${b.printer_count || 0}</td>
                <td style="padding: 8px; text-align: center;">${b.mfu_count || 0}</td>
                <td style="padding: 8px; text-align: center;">${b.network_count || 0}</td>
                <td style="padding: 8px; text-align: center;">${b.spm_count || 0}</td>
                <td style="padding: 8px; text-align: center;">${b.sempl_count || 0}</td>
                <td style="padding: 8px; text-align: center; color: #1a8f4c; font-weight: 500;">${b.working_count || 0}</td>
                <td style="padding: 8px; text-align: center; color: #b8730a;">${b.repair_count || 0}</td>
                <td style="padding: 8px; text-align: center; color: #6b7488;">${b.decommissioned_count || 0}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderSettlementStatsTable(settlements, settlementOnlineMap = {}) {
  if (!settlements || settlements.length === 0) {
    return '<div class="empty-state">Нет данных по населенным пунктам</div>';
  }
  return `
    <div class="table-container" style="overflow-x: auto; max-height: 520px; overflow-y: auto;">
      <table class="table" id="dashSettlementsTable" style="width:100%; border-collapse: collapse;">
        <thead style="position: sticky; top: 0; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,0.08);">
          <tr>
            <th data-sort-col="0" data-sort-type="str" style="text-align:left; padding: 10px;">Населенный пункт</th>
            <th data-sort-col="1" data-sort-type="str" style="text-align:left; padding: 10px;">Филиал</th>
            <th data-sort-col="2" style="padding: 10px;">Всего</th>
            <th data-sort-col="3" style="padding: 10px;">🟢 В сети</th>
            <th data-sort-col="4" style="padding: 10px;">ПК</th>
            <th data-sort-col="5" style="padding: 10px;">Принтеры</th>
            <th data-sort-col="6" style="padding: 10px;">МФУ</th>
            <th data-sort-col="7" style="padding: 10px;">Сеть</th>
            <th data-sort-col="8" style="padding: 10px;">СПМ</th>
            <th data-sort-col="9" style="padding: 10px;">другое</th>
            <th data-sort-col="10" style="padding: 10px;">Работают</th>
            <th data-sort-col="11" style="padding: 10px;">Ремонт</th>
            <th data-sort-col="12" style="padding: 10px;">Списаны</th>
          </tr>
        </thead>
        <tbody>
          ${settlements.map(s => {
            const online = settlementOnlineMap[s.id] || 0;
            return `
              <tr class="clickable" onclick="location.hash='#/branches/${s.municipal_branch_id}/settlements/${s.id}'" style="border-bottom: 1px solid var(--line); cursor: pointer;">
                <td style="padding: 8px; font-weight: 500;">${escapeHtml(s.name)}</td>
                <td style="padding: 8px; color: var(--ink-dim);">${escapeHtml(s.municipal_branch_name)}</td>
                <td style="padding: 8px; text-align: center; font-weight: 600;">${s.devices_count || 0}</td>
                <td style="padding: 8px; text-align: center; color: ${online > 0 ? '#1a8f4c' : 'var(--ink-dim)'}; font-weight: 600;">${online}</td>
                <td style="padding: 8px; text-align: center;">${s.pc_count || 0}</td>
                <td style="padding: 8px; text-align: center;">${s.printer_count || 0}</td>
                <td style="padding: 8px; text-align: center;">${s.mfu_count || 0}</td>
                <td style="padding: 8px; text-align: center;">${s.network_count || 0}</td>
                <td style="padding: 8px; text-align: center;">${s.spm_count || 0}</td>
                <td style="padding: 8px; text-align: center;">${s.sempl_count || 0}</td>
                <td style="padding: 8px; text-align: center; color: #1a8f4c; font-weight: 500;">${s.working_count || 0}</td>
                <td style="padding: 8px; text-align: center; color: #b8730a;">${s.repair_count || 0}</td>
                <td style="padding: 8px; text-align: center; color: #6b7488;">${s.decommissioned_count || 0}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ==================== ПРОКАЧАННАЯ ВКЛАДКА «ФИЛИАЛЫ» ====================
// Храним состояние развернутых филиалов между перерисовками
if (typeof window._expandedBranches === 'undefined') {
  window._expandedBranches = new Set();
}

async function renderBranchesList() {
  view.innerHTML = '<div class="empty-state">Загрузка…</div>';
  const [branches, settlements, allDevices] = await Promise.all([
    api('/api/branches'),
    api('/api/settlements'),
    api('/api/devices')
  ]);

  const anyEverScanned = allDevices.some(d => d.last_seen);

  // Группируем устройства по филиалам и населённым пунктам для мгновенного подсчета типов и онлайна
  const devicesByBranch = {};
  const devicesBySettlement = {};
  for (const d of allDevices) {
    if (!devicesByBranch[d.municipal_branch_id]) devicesByBranch[d.municipal_branch_id] = [];
    devicesByBranch[d.municipal_branch_id].push(d);

    if (!devicesBySettlement[d.settlement_branch_id]) devicesBySettlement[d.settlement_branch_id] = [];
    devicesBySettlement[d.settlement_branch_id].push(d);
  }

  view.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Муниципальные филиалы и пункты</h1>
        <p class="subtitle">Иерархия подразделений, сетевая доступность, контакты и быстрые операции</p>
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button class="btn" id="expandAllBranchesBtn">▼ Развернуть все</button>
        <button class="btn" id="collapseAllBranchesBtn">▲ Свернуть все</button>
        <button class="btn primary" id="addBranchBtn">+ Добавить филиал</button>
      </div>
    </div>

    <div class="toolbar" style="display:flex; flex-wrap:wrap; gap:10px; align-items:center; justify-content:space-between; margin-bottom:16px;">
      <input type="text" id="branchSearch" placeholder="Поиск по названию, ответственному, телефону или пункту..." style="width:100%; max-width:440px;">
      
      <!-- Панель групповых операций с выбранными населенными пунктами -->
      <div id="bulkSettlementActions" style="display:none; gap:8px; align-items:center; background:#fef3c7; border:1px solid #f59e0b; padding:6px 12px; border-radius:8px;">
        <span style="font-size:13px; font-weight:600; color:#92400e;">Выбрано пунктов: <span id="selectedSettlementsCount">0</span></span>
        <button type="button" class="btn small primary" id="bulkExportSettlementsBtn">⬇ Скачать опись Excel</button>
        <button type="button" class="btn small" id="bulkMoveSettlementsBtn" style="background:#d97706; color:#fff; border:none;">🔄 Перенести в другой филиал</button>
        <button type="button" class="btn small" id="bulkClearSettlementsBtn">Сброс</button>
      </div>
    </div>

    <div class="branches-tree" id="branchesTreeContainer">
      ${branches.length === 0 ? '<div class="empty-state">Филиалов пока нет.</div>' : branches.map(branch => {
        const branchSettlements = settlements.filter(s => s.municipal_branch_id === branch.id);
        const bDevices = devicesByBranch[branch.id] || [];
        const isExpanded = window._expandedBranches.has(branch.id);

        return `
          <div class="panel branch-panel" data-branch-id="${branch.id}" style="margin-bottom: 12px; padding: 14px 16px;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; cursor:pointer; flex-wrap:wrap;" class="branch-toggle">
              <div style="flex:1; min-width:260px;">
                <div style="display:flex; align-items:center; flex-wrap:wrap; gap:8px;">
                  <span class="branch-arrow" style="font-size:12px; color:var(--ink-dim); width:14px; display:inline-block;">${isExpanded ? '▼' : '▶'}</span>
                  <strong style="font-size:15.5px;">${escapeHtml(branch.name)}</strong>
                  <span style="color:var(--ink-dim); font-size:13px;">
                    (${branchSettlements.length} ${pluralizeRu(branchSettlements.length, ['пункт', 'пункта', 'пунктов'])}, ${bDevices.length} устр.)
                  </span>
                  ${renderNetworkHealthPill(bDevices, anyEverScanned)}
                  ${branch.repair_count ? `<span class="badge repair">${branch.repair_count} на ремонте</span>` : ''}
                </div>

                ${branch.notes ? `
                  <div style="margin-top:5px; margin-left:22px; font-size:12.5px; color:var(--ink-dim);">
                    📌 ${escapeHtml(branch.notes)}
                  </div>
                ` : ''}

                ${bDevices.length > 0 ? `
                  <div style="margin-top:6px; margin-left:22px; display:flex; flex-wrap:wrap; gap:5px;">
                    ${renderTypeBreakdownPills(bDevices)}
                  </div>
                ` : ''}
              </div>

              <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
                <button type="button" class="btn sm js-open-branch-page" data-branch-id="${branch.id}" title="Открыть карточку филиала">Открыть</button>
                <button type="button" class="btn sm js-export-branch" data-branch-id="${branch.id}" title="Выгрузить все устройства этого филиала в Excel">⬇ Excel</button>
                <button type="button" class="btn sm primary js-add-settlement" data-branch-id="${branch.id}">+ Пункт</button>
                <button type="button" class="btn sm js-edit-branch" data-branch-id="${branch.id}" title="Редактировать филиал и контакты">✏️</button>
                <button type="button" class="btn sm danger js-delete-branch" data-branch-id="${branch.id}" title="Удалить филиал">🗑️</button>
              </div>
            </div>
            
            <div class="branch-settlements" style="margin-top: 12px; padding-left: 18px; border-left: 2px solid var(--line, #e2e8f0); display: ${isExpanded ? 'block' : 'none'};">
              ${branchSettlements.length === 0 ? '<div style="color:var(--ink-dim); font-size:13px; padding:6px 0;">В этом филиале пока нет населённых пунктов</div>' : 
                branchSettlements.map(s => {
                  const sDevices = devicesBySettlement[s.id] || [];
                  return `
                    <div class="settlement-row" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; padding: 8px 6px; border-bottom: 1px solid var(--line, #f1f5f9);">
                      <div style="display:flex; align-items:flex-start; gap:10px; flex:1; min-width:240px;">
                        <input type="checkbox" class="settlement-checkbox" value="${s.id}" style="margin-top:4px; cursor:pointer;" title="Отметить для группового действия">
                        <div>
                          <div style="display:flex; align-items:center; flex-wrap:wrap; gap:8px;">
                            <a href="#/branches/${branch.id}/settlements/${s.id}" style="text-decoration:none; color:var(--ink); font-weight:500;">
                              📍 ${escapeHtml(s.name)}
                            </a>
                            <span style="font-size:12px; color:var(--ink-dim);">(${sDevices.length} устр.)</span>
                            ${renderNetworkHealthPill(sDevices, anyEverScanned)}
                            ${s.repair_count ? `<span class="badge repair" style="font-size:11px;">${s.repair_count} в ремонте</span>` : ''}
                          </div>
                          ${s.notes ? `<div style="font-size:12px; color:var(--ink-dim); margin-top:3px;">📞 ${escapeHtml(s.notes)}</div>` : ''}
                          ${sDevices.length > 0 ? `<div style="margin-top:4px; display:flex; flex-wrap:wrap; gap:4px;">${renderTypeBreakdownPills(sDevices)}</div>` : ''}
                        </div>
                      </div>

                      <div style="display:flex; gap:5px; flex-wrap:wrap; align-items:center;">
                        <button type="button" class="btn sm primary js-quick-add-device" data-settlement-id="${s.id}" data-branch-id="${branch.id}" title="Быстро добавить устройство в этот пункт">+ Устр.</button>
                        <button type="button" class="btn sm js-export-settlement" data-settlement-id="${s.id}" title="Скачать опись устройств пункта в Excel">⬇ Excel</button>
                        <button type="button" class="btn sm js-edit-settlement" data-settlement-id="${s.id}" title="Переименовать или изменить заметку/контакты">✏️</button>
                        <button type="button" class="btn sm danger js-delete-settlement" data-settlement-id="${s.id}" title="Удалить населённый пункт">🗑️</button>
                      </div>
                    </div>
                  `;
                }).join('')}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  const treeContainer = document.getElementById('branchesTreeContainer');
  const bulkBar = document.getElementById('bulkSettlementActions');
  const selectedCountEl = document.getElementById('selectedSettlementsCount');

  const updateBulkSettlementBar = () => {
    const checked = treeContainer.querySelectorAll('.settlement-checkbox:checked');
    if (checked.length > 0) {
      bulkBar.style.display = 'flex';
      selectedCountEl.textContent = checked.length;
    } else {
      bulkBar.style.display = 'none';
    }
  };

  treeContainer.addEventListener('change', (e) => {
    if (e.target.classList.contains('settlement-checkbox')) {
      updateBulkSettlementBar();
    }
  });

  // Кнопки "Развернуть все" / "Свернуть все"
  document.getElementById('expandAllBranchesBtn').onclick = () => {
    branches.forEach(b => window._expandedBranches.add(b.id));
    document.querySelectorAll('.branch-panel').forEach(panel => {
      const box = panel.querySelector('.branch-settlements');
      const arrow = panel.querySelector('.branch-arrow');
      if (box) box.style.display = 'block';
      if (arrow) arrow.textContent = '▼';
    });
  };

  document.getElementById('collapseAllBranchesBtn').onclick = () => {
    window._expandedBranches.clear();
    document.querySelectorAll('.branch-panel').forEach(panel => {
      const box = panel.querySelector('.branch-settlements');
      const arrow = panel.querySelector('.branch-arrow');
      if (box) box.style.display = 'none';
      if (arrow) arrow.textContent = '▶';
    });
  };

  // Групповые операции по выбранным чекбоксам населённых пунктов
  document.getElementById('bulkClearSettlementsBtn').onclick = () => {
    treeContainer.querySelectorAll('.settlement-checkbox:checked').forEach(cb => cb.checked = false);
    updateBulkSettlementBar();
  };

  document.getElementById('bulkExportSettlementsBtn').onclick = async () => {
    const selectedIds = new Set(Array.from(treeContainer.querySelectorAll('.settlement-checkbox:checked')).map(cb => Number(cb.value)));
    const subset = allDevices.filter(d => selectedIds.has(Number(d.settlement_branch_id)));
    await exportDevicesToExcelFile(subset, 'Опись_выбранных_пунктов');
  };

  document.getElementById('bulkMoveSettlementsBtn').onclick = () => {
    const selectedIds = Array.from(treeContainer.querySelectorAll('.settlement-checkbox:checked')).map(cb => Number(cb.value));
    if (!selectedIds.length) return;

    openModal('Переподчинить населённые пункты', `
      <div class="field">
        <label>Выберите целевой муниципальный филиал</label>
        <select name="targetBranchId" required>
          <option value="">Выберите филиал...</option>
          ${branches.map(b => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('')}
        </select>
      </div>
    `, async (data) => {
      await api('/api/settlements/move', {
        method: 'POST',
        body: JSON.stringify({
          settlementIds: selectedIds,
          targetBranchId: Number(data.targetBranchId)
        })
      });
      window._expandedBranches.add(Number(data.targetBranchId));
      await renderBranchesList();
    }, 'Перенести');
  };

  // Делегирование всех кнопок внутри дерева филиалов
  treeContainer.addEventListener('click', async (e) => {
    if (e.target.classList.contains('settlement-checkbox')) {
      e.stopPropagation();
      return;
    }

    const openBranchBtn = e.target.closest('.js-open-branch-page');
    if (openBranchBtn) {
      e.stopPropagation();
      location.hash = `#/branches/${openBranchBtn.dataset.branchId}`;
      return;
    }

    const exportBranchBtn = e.target.closest('.js-export-branch');
    if (exportBranchBtn) {
      e.stopPropagation();
      const bId = Number(exportBranchBtn.dataset.branchId);
      const b = branches.find(item => item.id === bId);
      const bDevices = devicesByBranch[bId] || [];
      await exportDevicesToExcelFile(bDevices, `Опись_${b?.name || 'Филиал'}`);
      return;
    }

    const addSettlementBtn = e.target.closest('.js-add-settlement');
    if (addSettlementBtn) {
      e.stopPropagation();
      const bId = Number(addSettlementBtn.dataset.branchId);
      window._expandedBranches.add(bId);
      openAddSettlementModal(bId);
      return;
    }

    const editBranchBtn = e.target.closest('.js-edit-branch');
    if (editBranchBtn) {
      e.stopPropagation();
      const b = branches.find(item => item.id === Number(editBranchBtn.dataset.branchId));
      if (b) openEditBranchModal(b);
      return;
    }

    const deleteBranchBtn = e.target.closest('.js-delete-branch');
    if (deleteBranchBtn) {
      e.stopPropagation();
      const b = branches.find(item => item.id === Number(deleteBranchBtn.dataset.branchId));
      if (b) openDeleteBranchModal(b.id, b.name);
      return;
    }

    const quickAddDevBtn = e.target.closest('.js-quick-add-device');
    if (quickAddDevBtn) {
      e.stopPropagation();
      const sId = Number(quickAddDevBtn.dataset.settlementId);
      const bId = Number(quickAddDevBtn.dataset.branchId);
      window._expandedBranches.add(bId);
      openDeviceForm(null, async (data) => {
        await api(`/api/settlements/${sId}/devices`, { method: 'POST', body: JSON.stringify(data) });
        await renderBranchesList();
        loadSidebarTotal();
      });
      return;
    }

    const exportSettlementBtn = e.target.closest('.js-export-settlement');
    if (exportSettlementBtn) {
      e.stopPropagation();
      const sId = Number(exportSettlementBtn.dataset.settlementId);
      const s = settlements.find(item => item.id === sId);
      const sDevices = devicesBySettlement[sId] || [];
      await exportDevicesToExcelFile(sDevices, `Опись_${s?.name || 'Пункт'}`);
      return;
    }

    const editSettlementBtn = e.target.closest('.js-edit-settlement');
    if (editSettlementBtn) {
      e.stopPropagation();
      const s = settlements.find(item => item.id === Number(editSettlementBtn.dataset.settlementId));
      if (s) openEditSettlementModal(s, branches);
      return;
    }

    const deleteSettlementBtn = e.target.closest('.js-delete-settlement');
    if (deleteSettlementBtn) {
      e.stopPropagation();
      const s = settlements.find(item => item.id === Number(deleteSettlementBtn.dataset.settlementId));
      if (s) openDeleteSettlementModal(s.id, s.name);
      return;
    }

    const toggleEl = e.target.closest('.branch-toggle');
    if (toggleEl) {
      const panel = toggleEl.closest('.branch-panel');
      const bId = Number(panel?.dataset.branchId);
      const settlementsContainer = toggleEl.nextElementSibling;
      const arrow = toggleEl.querySelector('.branch-arrow');
      if (settlementsContainer) {
        const willShow = settlementsContainer.style.display === 'none';
        settlementsContainer.style.display = willShow ? 'block' : 'none';
        if (arrow) arrow.textContent = willShow ? '▼' : '▶';
        if (willShow) window._expandedBranches.add(bId);
        else window._expandedBranches.delete(bId);
      }
    }
  });

  // Живой поиск с автоматическим разворотом найденных филиалов
  document.getElementById('branchSearch').oninput = (e) => {
    const val = e.target.value.trim().toLowerCase();
    document.querySelectorAll('.branch-panel').forEach(panel => {
      const text = panel.textContent.toLowerCase();
      const matches = !val || text.includes(val);
      panel.style.display = matches ? 'block' : 'none';
      if (val && matches) {
        const box = panel.querySelector('.branch-settlements');
        const arrow = panel.querySelector('.branch-arrow');
        if (box) box.style.display = 'block';
        if (arrow) arrow.textContent = '▼';
      }
    });
  };

  document.getElementById('addBranchBtn').onclick = () => {
    openModal('Новый муниципальный филиал', `
      <div class="field"><label>Название филиала</label><input name="name" required autofocus placeholder="Например: Барнаульский филиал"></div>
      <div class="field"><label>Контакты / ответственный / заметка (необязательно)</label><input name="notes" placeholder="Например: Начальник ИТ Петров П.П., тел. 10-20"></div>
    `, async (data) => {
      await api('/api/branches', { method: 'POST', body: JSON.stringify(data) });
      router();
    }, 'Добавить');
  };
}

// ==================== Вспомогательные функции для модалок в филиалах ====================
function openAddSettlementModal(branchId) {
  openModal('Новый населённый пункт', `
    <div class="field"><label>Название</label><input name="name" required autofocus placeholder="Например: г. Заречное"></div>
    <div class="field"><label>Контакты / ответственный / криптошлюз (необязательно)</label><input name="notes" placeholder="Например: отв. Иванов И.И., тел. +7..., ViPNet Coordinator #4"></div>
  `, async (data) => {
    await api(`/api/branches/${branchId}/settlements`, { method: 'POST', body: JSON.stringify(data) });
    router();
  }, 'Добавить');
}

function openEditBranchModal(branchObj) {
  openModal('Редактировать филиал', `
    <div class="field"><label>Название филиала</label><input name="name" required value="${escapeHtml(branchObj.name)}"></div>
    <div class="field"><label>Контакты / ответственный / заметка</label><input name="notes" value="${escapeHtml(branchObj.notes || '')}" placeholder="Например: Начальник ИТ Петров П.П., тел. 10-20"></div>
  `, async (data) => {
    await api(`/api/branches/${branchObj.id}`, { method: 'PUT', body: JSON.stringify(data) });
    router();
  });
}

function openDeleteBranchModal(branchId, branchName) {
  if (confirm(`Удалить филиал «${branchName}» вместе со всеми населёнными пунктами и устройствами? Это необратимо.`)) {
    api(`/api/branches/${branchId}`, { method: 'DELETE' }).then(() => router());
  }
}

function openEditSettlementModal(settlementObj, allBranches = null) {
  const branchSelectHtml = Array.isArray(allBranches) && allBranches.length > 0 ? `
    <div class="field">
      <label>Муниципальный филиал</label>
      <select name="municipal_branch_id">
        ${allBranches.map(b => `<option value="${b.id}" ${b.id === settlementObj.municipal_branch_id ? 'selected' : ''}>${escapeHtml(b.name)}</option>`).join('')}
      </select>
    </div>
  ` : '';

  openModal('Редактировать населённый пункт', `
    <div class="field"><label>Название</label><input name="name" required value="${escapeHtml(settlementObj.name)}"></div>
    ${branchSelectHtml}
    <div class="field"><label>Контакты / ответственный / заметка</label><input name="notes" value="${escapeHtml(settlementObj.notes || '')}" placeholder="Например: отв. Иванов И.И., тел. 12-34"></div>
  `, async (data) => {
    await api(`/api/settlements/${settlementObj.id}`, { method: 'PUT', body: JSON.stringify(data) });
    router();
  });
}

function openDeleteSettlementModal(settlementId, settlementName) {
  if (confirm(`Удалить населённый пункт «${settlementName}» вместе со всеми устройствами? Это необратимо.`)) {
    api(`/api/settlements/${settlementId}`, { method: 'DELETE' }).then(() => router());
  }
}

// ==================== Населённые пункты внутри филиала ====================
async function renderSettlementsList(branchId) {
  view.innerHTML = '<div class="empty-state">Загрузка…</div>';
  const [branch, settlements, allDevices] = await Promise.all([
    api(`/api/branches/${branchId}`),
    api(`/api/branches/${branchId}/settlements`),
    api('/api/devices')
  ]);

  const anyEverScanned = allDevices.some(d => d.last_seen);
  const branchDevices = allDevices.filter(d => String(d.municipal_branch_id) === String(branchId));
  const devicesBySettlement = {};
  for (const d of branchDevices) {
    if (!devicesBySettlement[d.settlement_branch_id]) devicesBySettlement[d.settlement_branch_id] = [];
    devicesBySettlement[d.settlement_branch_id].push(d);
  }

  view.innerHTML = `
    <div class="breadcrumb"><a href="#/branches">Филиалы</a> / ${escapeHtml(branch.name)}</div>
    <div class="page-header">
      <div>
        <h1>${escapeHtml(branch.name)}</h1>
        <p class="subtitle">${branch.notes ? `📌 ${escapeHtml(branch.notes)}` : 'Населённые пункты этого филиала'}</p>
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button class="btn" id="exportBranchExcelBtn">⬇ Опись филиала (Excel)</button>
        <button class="btn" id="renameBranchBtn">✏️ Изменить</button>
        <button class="btn danger" id="deleteBranchBtn">Удалить филиал</button>
        <button class="btn primary" id="addSettlementBtn">+ Добавить пункт</button>
      </div>
    </div>
    ${settlements.length === 0
      ? '<div class="empty-state">В этом филиале пока нет населённых пунктов.</div>'
      : `<div class="card-list">${settlements.map((s) => settlementCard(s, branchId, devicesBySettlement[s.id] || [], anyEverScanned)).join('')}</div>`}
  `;

  document.getElementById('exportBranchExcelBtn').onclick = () => {
    exportDevicesToExcelFile(branchDevices, `Опись_${branch.name}`);
  };
  document.getElementById('addSettlementBtn').onclick = () => openAddSettlementModal(branchId);
  document.getElementById('renameBranchBtn').onclick = () => openEditBranchModal(branch);
  document.getElementById('deleteBranchBtn').onclick = async () => {
    if (!confirm(`Удалить филиал «${branch.name}» вместе со всеми населёнными пунктами и устройствами? Это необратимо.`)) return;
    await api(`/api/branches/${branchId}`, { method: 'DELETE' });
    location.hash = '#/branches';
  };
}

function settlementCard(s, branchId, sDevices = [], anyEverScanned = false) {
  return `
    <a class="card-item" href="#/branches/${branchId}/settlements/${s.id}">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
        <div class="title">${escapeHtml(s.name)}</div>
        ${renderNetworkHealthPill(sDevices, anyEverScanned)}
      </div>
      ${s.notes ? `<div style="font-size:12px; color:var(--ink-dim); margin-top:4px;">📞 ${escapeHtml(s.notes)}</div>` : ''}
      <div class="meta" style="margin-top:6px;">
        <span>${sDevices.length} устройств</span>
        ${s.repair_count ? `<span style="color:var(--warn)">${s.repair_count} на ремонте</span>` : ''}
      </div>
      ${sDevices.length > 0 ? `<div style="margin-top:6px; display:flex; flex-wrap:wrap; gap:4px;">${renderTypeBreakdownPills(sDevices)}</div>` : ''}
    </a>
  `;
}

// ==================== Устройства внутри населённого пункта ====================
async function renderDevicesOfSettlement(branchId, settlementId) {
  view.innerHTML = '<div class="empty-state">Загрузка…</div>';
  const [branch, settlement, devices, allBranches] = await Promise.all([
    api(`/api/branches/${branchId}`),
    api(`/api/settlements/${settlementId}`),
    api(`/api/settlements/${settlementId}/devices`),
    api('/api/branches')
  ]);

  view.innerHTML = `
    <div class="breadcrumb"><a href="#/branches">Филиалы</a> / <a href="#/branches/${branchId}">${escapeHtml(branch.name)}</a> / ${escapeHtml(settlement.name)}</div>
    <div class="page-header">
      <div>
        <h1>${escapeHtml(settlement.name)}</h1>
        <p class="subtitle">${settlement.notes ? `📞 ${escapeHtml(settlement.notes)}` : 'ПК и принтеры этого населённого пункта'}</p>
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button class="btn" id="exportSettlementExcelBtn">⬇ Скачать опись (Excel)</button>
        <button class="btn" id="renameSettlementBtn">✏️ Изменить пункт</button>
        <button class="btn danger" id="deleteSettlementBtn">Удалить пункт</button>
        <button class="btn primary" id="addDeviceBtn">+ Добавить устройство</button>
      </div>
    </div>
    ${devicesTable(devices, { showLocation: false })}
  `;

  bindDeviceRowActions(devices, () => {
    renderDevicesOfSettlement(branchId, settlementId);
    loadSidebarTotal();
  });

  document.getElementById('exportSettlementExcelBtn').onclick = () => {
    const enriched = devices.map(d => ({ ...d, branch_name: branch.name, settlement_name: settlement.name }));
    exportDevicesToExcelFile(enriched, `Опись_${settlement.name}`);
  };

  document.getElementById('addDeviceBtn').onclick = () => openDeviceForm(null, async (data) => {
    await api(`/api/settlements/${settlementId}/devices`, { method: 'POST', body: JSON.stringify(data) });
    router();
  });
  document.getElementById('renameSettlementBtn').onclick = () => openEditSettlementModal(settlement, allBranches);
  document.getElementById('deleteSettlementBtn').onclick = async () => {
    if (!confirm(`Удалить населённый пункт «${settlement.name}» вместе со всеми устройствами? Это необратимо.`)) return;
    await api(`/api/settlements/${settlementId}`, { method: 'DELETE' });
    location.hash = `#/branches/${branchId}`;
  };
}

// ==================== Все устройства (глобальный список) ====================
async function renderAllDevices(query) {
  view.innerHTML = '<div class="empty-state">Загрузка…</div>';
  
  let [allDevices, branches, settlements, osOptions] = await Promise.all([
    api('/api/devices'),
    api('/api/branches'),
    api('/api/settlements'),
    fetchOsOptions()
  ]);

  view.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Все устройства</h1>
        <p class="subtitle">Полный список ПК и принтеров по всем филиалам</p>
      </div>
    </div>
    <div class="toolbar" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; align-items: center; margin-bottom: 20px;">
      
      <div style="grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 5px;">
        <button class="btn primary" id="importBtn">⬆ Импорт из Excel</button>
        <button class="btn" id="scanNetworkBtn">📡 Сканировать подсети</button>
        <button class="btn" id="moveDevicesBtn" style="display: none; background: #d97706; color: white;">🔄 Переместить выбранные (<span id="selectedCount">0</span>)</button>
      </div>
      
      <input type="text" id="searchInput" placeholder="Поиск по всем полям..." value="${escapeHtml(query.q || '')}" style="width: 100%;">
      
      <select id="branchFilter" style="width: 100%;">
        <option value="">Все филиалы</option>
        ${branches.map(b => `<option value="${b.id}" ${query.branch == b.id ? 'selected' : ''}>${escapeHtml(b.name)}</option>`).join('')}
      </select>
      
      <select id="settlementFilter" style="width: 100%;"></select>

      <select id="statusFilter" style="width: 100%;">
        <option value="">Все статусы</option>
        <option value="working" ${query.status === 'working' ? 'selected' : ''}>Работает</option>
        <option value="repair" ${query.status === 'repair' ? 'selected' : ''}>На ремонте</option>
        <option value="decommissioned" ${query.status === 'decommissioned' ? 'selected' : ''}>Списан</option>
      </select>

      <select id="typeFilter" style="width: 100%;">
        <option value="">Все типы</option>
        <option value="pc" ${query.type === 'pc' ? 'selected' : ''}>ПК</option>
        <option value="printer" ${query.type === 'printer' ? 'selected' : ''}>Принтеры</option>
        <option value="mfu" ${query.type === 'mfu' ? 'selected' : ''}>МФУ</option>
        <option value="network" ${query.type === 'network' ? 'selected' : ''}>Сетевые устройства</option>
        <option value="spm" ${query.type === 'spm' ? 'selected' : ''}>СПМ</option>
        <option value="sempl" ${query.type === 'sempl' ? 'selected' : ''}>другое</option>
      </select>

      <select id="osFilter" style="width: 100%;">
        <option value="">Все ОС</option>
        ${osOptions.map(os => `<option value="${escapeHtml(os)}" ${query.os === os ? 'selected' : ''}>${escapeHtml(os)}</option>`).join('')}
      </select>

      <select id="alertFilter" style="width: 100%;">
        <option value="">Контроль проблем: Все</option>
        <option value="stuck_repair" ${query.alert === 'stuck_repair' ? 'selected' : ''}>🔥 Зависший ремонт (&gt; ${STUCK_REPAIR_DAYS} дн.)</option>
        <option value="ghosts" ${query.alert === 'ghosts' ? 'selected' : ''}>👻 Призраки (офлайн &gt; ${GHOST_OFFLINE_DAYS} дн.)</option>
        <option value="online" ${query.alert === 'online' ? 'selected' : ''}>🟢 Сейчас в сети (Online)</option>
        <option value="offline" ${query.alert === 'offline' ? 'selected' : ''}>⚪ Сейчас не в сети (Offline)</option>
        <option value="no_domain" ${query.alert === 'no_domain' ? 'selected' : ''}>🛡️ ПК вне домена</option>
        <option value="no_szi" ${query.alert === 'no_szi' ? 'selected' : ''}>🛡️ ПК без СЗИ</option>
        <option value="no_os" ${query.alert === 'no_os' ? 'selected' : ''}>💿 Не указана ОС</option>
      </select>
    </div>
    <div class="devices-table-wrapper"></div>
  `;

  const searchInput = document.getElementById('searchInput');
  const branchFilter = document.getElementById('branchFilter');
  const settlementFilter = document.getElementById('settlementFilter');
  const statusFilter = document.getElementById('statusFilter');
  const typeFilter = document.getElementById('typeFilter');
  const osFilter = document.getElementById('osFilter');
  const alertFilter = document.getElementById('alertFilter');
  const moveDevicesBtn = document.getElementById('moveDevicesBtn');
  const wrapper = document.querySelector('.devices-table-wrapper');

  populateSettlementSelect(settlementFilter, settlements, branchFilter.value, query.settlement || '', 'Все нас. пункты');

  branchFilter.addEventListener('change', () => {
    populateSettlementSelect(settlementFilter, settlements, branchFilter.value, settlementFilter.value, 'Все нас. пункты');
    refreshTable();
  });

  const refreshTable = () => {
    const q = searchInput.value.trim().toLowerCase();
    const branchVal = branchFilter.value;
    const settlementVal = settlementFilter.value;
    const statusVal = statusFilter.value;
    const typeVal = typeFilter.value;
    const osVal = osFilter.value;
    const alertVal = alertFilter.value;

    const filteredDevices = allDevices.filter(d => {
      if (branchVal && String(d.municipal_branch_id) !== branchVal) return false;
      if (settlementVal && String(d.settlement_branch_id) !== settlementVal) return false;
      if (statusVal && d.status !== statusVal) return false;
      if (typeVal && d.type !== typeVal) return false;
      if (osVal && d.os !== osVal) return false;

      if (alertVal === 'stuck_repair' && !isStuckRepair(d)) return false;
      if (alertVal === 'ghosts' && !isGhostDevice(d)) return false;
      if (alertVal === 'online' && !d.is_online) return false;
      if (alertVal === 'offline' && d.is_online) return false;
      if (alertVal === 'no_domain' && (d.status !== 'working' || d.domain_joined === 'Да')) return false;
      if (alertVal === 'no_szi' && (d.status !== 'working' || (d.security && d.security.trim() !== ''))) return false;
      if (alertVal === 'no_os' && (d.status !== 'working' || (d.os && d.os.trim() !== ''))) return false;

      if (q) {
        const searchString = Object.values(d)
          .map(val => (val !== null && val !== undefined) ? String(val).toLowerCase() : '')
          .join(' ');
        if (!searchString.includes(q)) return false;
      }
      return true;
    });

    if (wrapper) {
      wrapper.innerHTML = devicesTable(filteredDevices, { showLocation: true });
      bindDeviceRowActions(filteredDevices, async () => {
        allDevices = await api('/api/devices');
        refreshTable();
        loadSidebarTotal();
        loadRepairBanner();
      });
      moveDevicesBtn.style.display = 'none';
    }
    updateUrlQuery();
  };

  const updateUrlQuery = () => {
    const p = new URLSearchParams();
    if (searchInput.value.trim()) p.set('q', searchInput.value.trim());
    if (branchFilter.value) p.set('branch', branchFilter.value);
    if (settlementFilter.value) p.set('settlement', settlementFilter.value);
    if (statusFilter.value) p.set('status', statusFilter.value);
    if (typeFilter.value) p.set('type', typeFilter.value);
    if (osFilter.value) p.set('os', osFilter.value);
    if (alertFilter.value) p.set('alert', alertFilter.value);
    
    const newHash = '#/devices' + (p.toString() ? '?' + p.toString() : '');
    if (history.replaceState) history.replaceState(null, null, newHash);
  };

  let searchTimeout;
  searchInput.oninput = () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(refreshTable, 350);
  };
  settlementFilter.addEventListener('change', refreshTable);
  statusFilter.addEventListener('change', refreshTable);
  typeFilter.addEventListener('change', refreshTable);
  osFilter.addEventListener('change', refreshTable);
  alertFilter.addEventListener('change', refreshTable);

  refreshTable();

  document.getElementById('scanNetworkBtn').onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = '⏳ Сканируем подсети...';
    try {
      const res = await api('/api/scan', { method: 'POST' });
      alert(
        `Сканирование завершено!\n` +
        `Проверено IP: ${res.scannedIps}\n` +
        `Сейчас онлайн: ${res.onlineCount}\n` +
        `Новых устройств добавлено: ${res.autoCreated}\n` +
        `Авто-перемещено по подсетям: ${res.autoMoved}`
      );
      [allDevices, branches, settlements] = await Promise.all([
        api('/api/devices'),
        api('/api/branches'),
        api('/api/settlements')
      ]);
      populateSettlementSelect(settlementFilter, settlements, branchFilter.value, settlementFilter.value, 'Все нас. пункты');
      refreshTable();
      loadSidebarTotal();
    } catch (err) {
      alert('Ошибка сканирования: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '📡 Сканировать подсети';
    }
  };

  wrapper.addEventListener('change', (e) => {
    if (e.target.id === 'selectAllDevices') {
      const checkboxes = wrapper.querySelectorAll('.device-checkbox');
      checkboxes.forEach(cb => cb.checked = e.target.checked);
    }
    
    const selected = wrapper.querySelectorAll('.device-checkbox:checked');
    if (selected.length > 0) {
      moveDevicesBtn.style.display = 'inline-block';
      document.getElementById('selectedCount').textContent = selected.length;
    } else {
      moveDevicesBtn.style.display = 'none';
    }
  });

  moveDevicesBtn.onclick = () => {
    const selectedIds = Array.from(wrapper.querySelectorAll('.device-checkbox:checked')).map(cb => Number(cb.value));
    if (!selectedIds.length) return;

    openModal('Перемещение устройств', `
      <div style="margin-bottom: 15px;">
        <label style="font-weight: 500; font-size: 14px;">Новый филиал:</label>
        <select id="moveBranchSelect" style="width: 100%; margin-top: 8px; padding: 6px;">
          <option value="">Выберите филиал...</option>
          ${branches.map(b => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('')}
        </select>
      </div>
      <div style="margin-bottom: 15px;">
        <label style="font-weight: 500; font-size: 14px;">Новый населенный пункт:</label>
        <select id="moveSettlementSelect" style="width: 100%; margin-top: 8px; padding: 6px;">
          <option value="">Сначала выберите филиал...</option>
        </select>
      </div>
    `, async () => {
      const newBranch = document.getElementById('moveBranchSelect').value;
      const newSettlement = document.getElementById('moveSettlementSelect').value;
      
      if (!newBranch || !newSettlement) {
        throw new Error('Пожалуйста, выберите филиал и населенный пункт.');
      }

      const word = pluralizeRu(selectedIds.length, ['устройство', 'устройства', 'устройств']);
      if (!confirm(`Вы уверены, что хотите переместить ${selectedIds.length} ${word}?`)) {
        return false;
      }

      await api('/api/devices/move', {
        method: 'POST',
        body: JSON.stringify({
          deviceIds: selectedIds,
          settlement_branch_id: Number(newSettlement)
        })
      });

      allDevices = await api('/api/devices');
      refreshTable();
      moveDevicesBtn.style.display = 'none';
    });

    const moveBranchSelect = document.getElementById('moveBranchSelect');
    const moveSettlementSelect = document.getElementById('moveSettlementSelect');
    
    moveBranchSelect.onchange = () => {
      const bId = moveBranchSelect.value;
      if (!bId) {
        moveSettlementSelect.innerHTML = '<option value="">Сначала выберите филиал...</option>';
        return;
      }
      populateSettlementSelect(moveSettlementSelect, settlements, bId, '', 'Выберите нас. пункт...');
    };
  };

  document.getElementById('importBtn').onclick = () => {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.xlsx,.xls';
    fileInput.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const data = await file.arrayBuffer();
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet);

        if (rows.length === 0) {
          alert('Файл пуст или имеет неправильный формат.');
          return;
        }

        const result = await api('/api/import', { method: 'POST', body: JSON.stringify({ rows }) });
        showImportReportModal(result);
        
        [allDevices, osOptions] = await Promise.all([api('/api/devices'), fetchOsOptions()]);
        refreshTable();
        loadSidebarTotal();
      } catch (err) {
        alert('Ошибка импорта: ' + err.message);
      }
    };
    fileInput.click();
  };

  function showImportReportModal(result) {
    const { insertedDevices, updatedDevices, newBranches, newSettlements, errorCount, errors } = result;

    openModal('Результаты импорта из Excel', `
      <div style="font-size: 14px; margin-bottom: 15px; line-height: 1.5;">
        <p style="color: var(--success, #1a8f4c); margin-bottom: 4px;">✅ Успешно обработано: <b>${(insertedDevices || 0) + (updatedDevices || 0)}</b> (новых: ${insertedDevices}, обновлено: ${updatedDevices})</p>
        <p style="color: var(--ink-dim); margin-bottom: 4px;">📁 Создано филиалов: <b>${newBranches}</b>, нас. пунктов: <b>${newSettlements}</b></p>
        <p style="color: ${errorCount > 0 ? '#b8730a' : 'var(--ink)'};">⚠️ С ошибками пропущено строк: <b>${errorCount}</b></p>
      </div>
      ${errorCount > 0 ? `
        <div style="border-top: 1px solid var(--line); padding-top: 10px;">
          <h4 style="font-size: 13px; margin-bottom: 8px;">Список ошибок по строкам файла:</h4>
          <div style="max-height: 220px; overflow-y: auto; background: var(--bg-alt, #f8f9fa); padding: 8px; border-radius: 6px;">
            ${errors.map(err => `
              <div style="font-size: 12px; padding: 6px 0; border-bottom: 1px solid var(--line);">
                <span style="font-weight:600; color:#b8730a;">Строка ${err.row}</span> (Инв: ${escapeHtml(err.inventory)}):<br>
                <span style="color:var(--ink-dim);">${escapeHtml(err.reason)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      ` : '<div style="color:#1a8f4c; font-size:13px; font-weight:500; margin-top:10px;">Файл загружен абсолютно без ошибок! 🎉</div>'}
    `, () => {}, 'Закрыть');
  }
}

// ==================== ГЛОБАЛЬНЫЙ ЖУРНАЛ СОБЫТИЙ (АУДИТ) ====================
async function renderHistoryPage() {
  view.innerHTML = '<div class="empty-state">Загрузка журнала событий…</div>';
  
  const historyItems = await api('/api/history?limit=150');

  view.innerHTML = `
    <div class="page-header">
      <div>
        <h1>📜 Журнал событий</h1>
        <p class="subtitle">Лента всех изменений, сетевых авто-перемещений, правок и статусов в инфраструктуре</p>
      </div>
      <button class="btn" id="refreshHistoryBtn">🔄 Обновить</button>
    </div>

    <div class="panel">
      ${historyItems.length === 0 ? '<div class="empty-state">Журнал событий пока пуст.</div>' : `
        <div class="table-container" style="max-height: 70vh; overflow-y: auto;">
          <table class="table" style="width:100%; border-collapse: collapse;">
            <thead style="position: sticky; top: 0; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,0.1);">
              <tr>
                <th style="padding: 10px; text-align: left; width: 150px;">Дата и время</th>
                <th style="padding: 10px; text-align: left; width: 110px;">Действие</th>
                <th style="padding: 10px; text-align: left;">Устройство / Инв. номер</th>
                <th style="padding: 10px; text-align: left;">Расположение</th>
                <th style="padding: 10px; text-align: left;">Описание события</th>
              </tr>
            </thead>
            <tbody>
              ${historyItems.map(h => {
                const badgeColor = 
                  h.action === 'CREATED' ? '#1a8f4c' :
                  h.action === 'UPDATED' ? '#0284c7' :
                  h.action === 'TRASHED' ? '#b8730a' :
                  h.action === 'DELETED' ? '#dc3545' : '#6b7488';

                return `
                  <tr style="border-bottom: 1px solid var(--line); font-size: 13.5px;">
                    <td style="padding: 8px; color: var(--ink-dim); white-space: nowrap;">${fmtDate(h.created_at)}</td>
                    <td style="padding: 8px;">
                      <span style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; color: #fff; background: ${badgeColor};">
                        ${escapeHtml(h.action)}
                      </span>
                    </td>
                    <td style="padding: 8px;">
                      <strong>${escapeHtml(h.device_name)}</strong>
                      ${h.inventory_number ? `<br><code style="font-size: 11.5px;">${escapeHtml(cleanInvNumber(h.inventory_number))}</code>` : ''}
                    </td>
                    <td style="padding: 8px; color: var(--ink-dim);">
                      ${h.branch_name ? `${escapeHtml(h.branch_name)} / ${escapeHtml(h.settlement_name)}` : '—'}
                    </td>
                    <td style="padding: 8px;">${escapeHtml(h.description)}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `}
    </div>
  `;

  document.getElementById('refreshHistoryBtn').onclick = () => renderHistoryPage();
}

// ==================== КОРЗИНА (УДАЛЕННЫЕ УСТРОЙСТВА) ====================
async function renderTrash() {
  view.innerHTML = '<div class="empty-state">Загрузка корзины…</div>';
  const trashedDevices = await api('/api/devices/trash');

  view.innerHTML = `
    <div class="page-header">
      <div>
        <h1>🗑️ Корзина</h1>
        <p class="subtitle">Удалённые устройства можно восстановить обратно в филиал или стереть навсегда</p>
      </div>
      ${trashedDevices.length > 0 ? `<button class="btn danger" id="emptyTrashBtn">Очистить корзину (${trashedDevices.length})</button>` : ''}
    </div>

    ${trashedDevices.length === 0
      ? '<div class="empty-state">В корзине пусто.</div>'
      : `
        <div class="panel">
          <table>
            <thead>
              <tr>
                <th>Тип</th>
                <th>Инв. номер</th>
                <th>Название</th>
                <th>IP-адрес</th>
                <th>Прежнее расположение</th>
                <th>Дата удаления</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="trashTableBody">
              ${trashedDevices.map(d => `
                <tr data-device-id="${d.id}">
                  <td>${TYPE_LABELS[d.type] || d.type}</td>
                  <td class="mono">${escapeHtml(cleanInvNumber(d.inventory_number))}</td>
                  <td><strong>${escapeHtml(d.name)}</strong></td>
                  <td class="mono">${d.ip_address ? escapeHtml(d.ip_address) : '—'}</td>
                  <td>${escapeHtml(d.branch_name || '—')} / ${escapeHtml(d.settlement_name || '—')}</td>
                  <td style="color:var(--ink-dim); font-size:13px;">${fmtDate(d.deleted_at)}</td>
                  <td style="white-space:nowrap; text-align:right;">
                    <button class="btn small primary js-restore-btn">↩ Восстановить</button>
                    <button class="btn small danger js-perm-delete-btn">Удалить навсегда</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `}
  `;

  const emptyBtn = document.getElementById('emptyTrashBtn');
  if (emptyBtn) {
    emptyBtn.onclick = async () => {
      if (!confirm(`Вы уверены, что хотите БЕЗВОЗВРАТНО удалить все устройства в корзине (${trashedDevices.length} шт.)?`)) return;
      await api('/api/devices/trash/empty', { method: 'DELETE' });
      await renderTrash();
      loadSidebarTotal();
    };
  }

  const tbody = document.getElementById('trashTableBody');
  if (tbody) {
    tbody.addEventListener('click', async (e) => {
      const tr = e.target.closest('tr');
      if (!tr) return;
      const id = tr.dataset.deviceId;
      const dev = trashedDevices.find(item => String(item.id) === String(id));
      if (!dev) return;

      if (e.target.closest('.js-restore-btn')) {
        try {
          await api(`/api/devices/${id}/restore`, { method: 'POST' });
          await renderTrash();
          loadSidebarTotal();
        } catch (err) {
          alert('Ошибка восстановления: ' + err.message);
        }
      } else if (e.target.closest('.js-perm-delete-btn')) {
        const cleanInv = cleanInvNumber(dev.inventory_number);
        if (!confirm(`Удалить устройство «${dev.name}» (инв. № ${cleanInv}) НАВСЕГДА без возможности восстановления?`)) return;
        try {
          await api(`/api/devices/${id}/permanent`, { method: 'DELETE' });
          await renderTrash();
          loadSidebarTotal();
        } catch (err) {
          alert('Ошибка удаления: ' + err.message);
        }
      }
    });
  }
}

// ==================== Таблица устройств (переиспользуемая) ====================
function devicesTable(devices, { showLocation }) {
  if (devices.length === 0) return '<div class="empty-state">Устройств не найдено.</div>';
  return `
    <table>
      <thead><tr>
        <th style="width: 40px; text-align: center;"><input type="checkbox" id="selectAllDevices"></th>
        <th style="width:80px;">Тип</th>
        <th style="width:80px;">Инв. номер</th>
        <th style="width:80px;">Название</th>
        <th style="width:130px;">IP-адрес</th>
        <th style="width:80px;">ОС</th>
        <th style="width:80px;">Софт</th>
        <th style="width:80px;">СЗИ</th>
        <th style="width:80px;">Ввод в домен</th>
        ${showLocation ? '<th style="width:80px;">Расположение</th>' : ''}
        <th style="width:80px;">Примечание</th>
        <th style="width:110px;">Статус</th>
        <th style="width:80px;"></th>
      </tr></thead>
      <tbody>
        ${devices.map((d) => {
          const ghost = isGhostDevice(d);
          const offlineDays = getOfflineDays(d);
          return `
            <tr data-device-id="${d.id}">
              <td style="text-align: center;"><input type="checkbox" class="device-checkbox" value="${d.id}"></td>
              <td>${TYPE_LABELS[d.type] || d.type}</td>
              <td class="mono">${escapeHtml(d.inventory_number)}</td>
              <td>${escapeHtml(d.name)}</td>
              <td class="mono" style="white-space:nowrap;">
                ${d.ip_address ? `
                  <span title="${d.is_online ? 'В сети (Online)' : 'Не отвечает на пинг'}${d.last_seen ? ' | Был в сети: ' + fmtDate(d.last_seen) : ' | Ни разу не пинговался'}"
                        style="display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:6px; background:${d.is_online ? '#1a8f4c' : '#cbd5e1'};">
                  </span>${escapeHtml(d.ip_address)}
                  ${ghost ? `<br><span title="Не выходил на связь ${offlineDays} дн." style="font-size:11px; color:#6366f1; font-weight:600;">👻 ${offlineDays} дн. офлайн</span>` : ''}
                ` : '—'}
              </td>
              <td>${escapeHtml(d.os) || '—'}</td>
              <td>${escapeHtml(d.software) || '—'}</td>
              <td>${escapeHtml(d.security) || '—'}</td>
              <td>${escapeHtml(d.domain_joined) || '—'}</td>
              ${showLocation ? `<td>${escapeHtml(d.branch_name)} / ${escapeHtml(d.settlement_name)}</td>` : ''}
              <td>${escapeHtml(d.notes) || '—'}</td>
              <td>${statusBadge(d.status, d)}</td>
              <td style="white-space:nowrap;">
                <button class="btn small edit-device-btn">Изменить</button>
                <button class="btn small danger delete-device-btn" title="Переместить в корзину">В корзину</button>
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

function bindDeviceRowActions(devices, onChange) {
  document.querySelectorAll('.edit-device-btn').forEach((btn) => {
    btn.onclick = () => {
      const id = btn.closest('tr').dataset.deviceId;
      const device = devices.find((d) => String(d.id) === id);
      openDeviceForm(device, async (data) => {
        await api(`/api/devices/${id}`, { method: 'PUT', body: JSON.stringify(data) });
        onChange();
      });
    };
  });
  document.querySelectorAll('.delete-device-btn').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.closest('tr').dataset.deviceId;
      const device = devices.find((d) => String(d.id) === id);
      if (!confirm(`Переместить устройство «${device.name}» (инв. № ${device.inventory_number}) в корзину?`)) return;
      await api(`/api/devices/${id}`, { method: 'DELETE' });
      onChange();
    };
  });
}

// ==================== Форма устройства (добавление/редактирование) ====================
async function openDeviceForm(device, onSubmit) {
  const isEdit = !!device;
  const osOptions = await fetchOsOptions();

  openModal(isEdit ? 'Изменить устройство' : 'Новое устройство', `
    <div class="field">
      <label>Тип устройства</label>
      <select name="type" required>
        <option value="pc" ${device?.type === 'pc' ? 'selected' : ''}>ПК</option>
        <option value="printer" ${device?.type === 'printer' ? 'selected' : ''}>Принтер</option>
        <option value="mfu" ${device?.type === 'mfu' ? 'selected' : ''}>МФУ</option>
        <option value="network" ${device?.type === 'network' ? 'selected' : ''}>Сетевые устройства</option>
        <option value="spm" ${device?.type === 'spm' ? 'selected' : ''}>СПМ</option>
        <option value="sempl" ${device?.type === 'sempl' ? 'selected' : ''}>другое</option>
      </select>
    </div>
    <div class="field">
      <label>Инвентарный номер</label>
      <input name="inventory_number" required value="${escapeHtml(device?.inventory_number || '')}">
    </div>
    <div class="field">
      <label>Название</label>
      <input name="name" required value="${escapeHtml(device?.name || '')}" placeholder="Например: ws01 или ПК бухгалтерии">
    </div>
    <div class="field">
      <label>IP-адрес (при вводе известной подсети пункт определится сам)</label>
      <input name="ip_address" value="${escapeHtml(device?.ip_address || '')}" placeholder="192.168.1.10">
    </div>
    <div class="field">
      <label>Операционная система</label>
      <input name="os" list="osDatalist" value="${escapeHtml(device?.os || '')}" placeholder="Выберите или введите ОС (напр. Red OS)">
      <datalist id="osDatalist">
        ${osOptions.map(os => `<option value="${escapeHtml(os)}"></option>`).join('')}
      </datalist>
    </div>
    <div class="field">
      <label>Софт (установленное ПО)</label>
      <input name="software" value="${escapeHtml(device?.software || '')}" placeholder="Например: 1С, МойОфис...">
    </div>
    <div class="field">
      <label>СЗИ (средства защиты)</label>
      <input name="security" value="${escapeHtml(device?.security || '')}" placeholder="Например: Kaspersky, Dallas Lock...">
    </div>
    <div class="field">
      <label>Статус ввода в домен</label>
      <select name="domain_joined">
        <option value="">— Не указано —</option>
        <option value="Да" ${device?.domain_joined === 'Да' ? 'selected' : ''}>Да</option>
        <option value="Нет" ${device?.domain_joined === 'Нет' ? 'selected' : ''}>Нет</option>
      </select>
    </div>
    <div class="field">
      <label>Примечание (для внутреннего контроля)</label>
      <textarea name="notes" rows="2" style="width:100%; padding:8px; border:1px solid var(--line); border-radius:8px; font-family:inherit; font-size:13.5px;">${escapeHtml(device?.notes || '')}</textarea>
    </div>
    <div class="field">
      <label>Статус</label>
      <select name="status" required>
        <option value="working" ${(!device || device.status === 'working') ? 'selected' : ''}>Работает</option>
        <option value="repair" ${device?.status === 'repair' ? 'selected' : ''}>На ремонте</option>
        <option value="decommissioned" ${device?.status === 'decommissioned' ? 'selected' : ''}>Списан</option>
      </select>
    </div>

    ${isEdit ? '<div id="deviceHistoryContainer"></div>' : ''}
  `, async (data) => {
    await onSubmit(data);
  }, isEdit ? 'Сохранить' : 'Добавить');

  if (isEdit && device?.id) {
    loadDeviceHistory(device.id).then(html => {
      const container = document.getElementById('deviceHistoryContainer');
      if (container) container.innerHTML = html;
    });
  }
}

// ============================================================
//                    ЭКСПОРТ В EXCEL С ВЫБОРОМ
// ============================================================
if (typeof window._exportSelection === 'undefined') {
  window._exportSelection = {};
}

async function renderExport() {
  try {
    const [devices, branches, settlements, osOptions] = await Promise.all([
      api('/api/devices'),
      api('/api/branches'),
      api('/api/settlements'),
      fetchOsOptions()
    ]);

    const validIds = new Set(devices.map(d => d.id));
    for (const id in window._exportSelection) {
      if (!validIds.has(parseInt(id))) {
        delete window._exportSelection[id];
      }
    }

    view.innerHTML = `
      <div class="card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
          <h2>Экспорт в Excel</h2>
          <button id="btnDownloadExcel" class="btn btn-primary" style="background-color: #1a8f4c; border:none; color:white; padding:8px 16px; border-radius:4px; cursor:pointer;">⬇ Скачать Excel</button>
        </div>
        <p style="margin-bottom: 15px; color: #666;">
          Вы можете отфильтровать устройства, отметить нужные галочками и выгрузить их в один файл.
        </p>

        <div class="export-filters" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 25px; background: #f8f9fa; padding: 15px; border-radius: 8px; border: 1px solid #e9ecef;">
          <div>
            <label style="display: block; margin-bottom: 5px; font-weight: 500;">Муниципальный филиал</label>
            <select id="exportFilterBranch" class="form-control" style="width: 100%; padding: 6px; border-radius: 4px; border: 1px solid #ccc;">
              <option value="">Все филиалы</option>
              ${branches.map(b => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="display: block; margin-bottom: 5px; font-weight: 500;">Населенный пункт</label>
            <select id="exportFilterSettlement" class="form-control" style="width: 100%; padding: 6px; border-radius: 4px; border: 1px solid #ccc;"></select>
          </div>
          <div>
            <label style="display: block; margin-bottom: 5px; font-weight: 500;">Статус устройства</label>
            <select id="exportFilterStatus" class="form-control" style="width: 100%; padding: 6px; border-radius: 4px; border: 1px solid #ccc;">
              <option value="">Все статусы</option>
              <option value="working">Работает</option>
              <option value="repair">На ремонте</option>
              <option value="decommissioned">Списан</option>
            </select>
          </div>
          <div>
            <label style="display: block; margin-bottom: 5px; font-weight: 500;">Тип техники</label>
            <select id="exportFilterType" class="form-control" style="width: 100%; padding: 6px; border-radius: 4px; border: 1px solid #ccc;">
              <option value="">Все типы</option>
              <option value="pc">ПК</option>
              <option value="printer">Принтер</option>
              <option value="mfu">МФУ</option>
              <option value="network">Сетевые устройства</option>
              <option value="spm">СПМ</option>
              <option value="sempl">другое</option>
            </select>
          </div>
          <div>
            <label style="display: block; margin-bottom: 5px; font-weight: 500;">ОС</label>
            <select id="exportFilterOs" class="form-control" style="width: 100%; padding: 6px; border-radius: 4px; border: 1px solid #ccc;">
              <option value="">Все ОС</option>
              ${osOptions.map(os => `<option value="${escapeHtml(os)}">${escapeHtml(os)}</option>`).join('')}
            </select>
          </div>
        </div>

        <div style="display: flex; gap: 10px; align-items: center; margin-bottom: 15px; flex-wrap: wrap;">
          <button id="btnExportSelectVisible" class="btn btn-secondary btn-sm" style="padding:6px 12px; cursor:pointer;">Выбрать отфильтрованные</button>
          <button id="btnExportDeselectVisible" class="btn btn-secondary btn-sm" style="padding:6px 12px; cursor:pointer;">Снять выбор с видимых</button>
          <button id="btnExportClearAll" class="btn btn-danger btn-sm" style="background-color: #dc3545; border:none; color: white; padding:6px 12px; border-radius:4px; cursor:pointer;">Сбросить весь выбор</button>
          <span id="exportSelectedCount" style="margin-left: auto; font-weight: 500; color: #333;">Выбрано устройств: 0</span>
        </div>

        <div class="table-container" style="overflow-y: auto;">
          <table class="table" style="width:100%; border-collapse: collapse;">
            <thead style="position: sticky; top: 0; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,0.1);">
              <tr>
                <th style="padding: 10px; border-bottom: 2px solid #ddd; width:40px;"><input type="checkbox" id="chkExportSelectAllHeader"></th>
                <th style="padding: 10px; border-bottom: 2px solid #ddd; text-align:left;">Филиал / Населенный пункт</th>
                <th style="padding: 10px; border-bottom: 2px solid #ddd; text-align:left;">Тип</th>
                <th style="padding: 10px; border-bottom: 2px solid #ddd; text-align:left;">Инв. номер</th>
                <th style="padding: 10px; border-bottom: 2px solid #ddd; text-align:left;">Название</th>
                <th style="padding: 10px; border-bottom: 2px solid #ddd; text-align:left;">IP-адрес</th>
                <th style="padding: 10px; border-bottom: 2px solid #ddd; text-align:left;">Статус</th>
              </tr>
            </thead>
            <tbody id="exportTableBody"></tbody>
          </table>
        </div>
      </div>
    `;

    const filterBranch = document.getElementById('exportFilterBranch');
    const filterSettlement = document.getElementById('exportFilterSettlement');
    const filterStatus = document.getElementById('exportFilterStatus');
    const filterType = document.getElementById('exportFilterType');
    const tableBody = document.getElementById('exportTableBody');
    const chkHeader = document.getElementById('chkExportSelectAllHeader');
    const selectedCountSpan = document.getElementById('exportSelectedCount');
    const filterOs = document.getElementById('exportFilterOs');

    let filteredDevices = [];

    populateSettlementSelect(filterSettlement, settlements, '', '', 'Все населенные пункты');

    const currentHash = window.location.hash;
    if (currentHash.includes('?')) {
      const urlParams = new URLSearchParams(currentHash.split('?')[1]);
      if (urlParams.has('os')) {
        filterOs.value = urlParams.get('os');
      }
    }

    filterBranch.addEventListener('change', () => {
      populateSettlementSelect(filterSettlement, settlements, filterBranch.value, filterSettlement.value, 'Все населенные пункты');
      updateTable();
    });

    function updateTable() {
      const branchVal = filterBranch.value;
      const settlementVal = filterSettlement.value;
      const statusVal = filterStatus.value;
      const typeVal = filterType.value;
      const osVal = filterOs.value;

      filteredDevices = devices.filter(d => {
        const matchesBranch = !branchVal || d.municipal_branch_id === parseInt(branchVal);
        const matchesSettlement = !settlementVal || d.settlement_branch_id === parseInt(settlementVal);
        const matchesStatus = !statusVal || d.status === statusVal;
        const matchesType = !typeVal || d.type === typeVal;
        const matchesOs = !osVal || d.os === osVal;
        return matchesBranch && matchesSettlement && matchesStatus && matchesType && matchesOs;
      });

      if (filteredDevices.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: #999; padding: 20px;">Нет устройств, соответствующих выбранным фильтрам</td></tr>`;
      } else {
        tableBody.innerHTML = filteredDevices.map(d => {
          const checked = window._exportSelection[d.id] ? 'checked' : '';
          return `
            <tr style="border-bottom: 1px solid #eee;">
              <td style="padding: 8px; text-align:center;"><input type="checkbox" class="export-row-chk" data-id="${d.id}" ${checked}></td>
              <td style="padding: 8px;">
                <div style="font-weight: 500;">${escapeHtml(d.branch_name)}</div>
                <div style="font-size: 0.85em; color: #666;">${escapeHtml(d.settlement_name)}</div>
              </td>
              <td style="padding: 8px;">${TYPE_LABELS[d.type] || d.type}</td>
              <td style="padding: 8px;"><code>${escapeHtml(d.inventory_number)}</code></td>
              <td style="padding: 8px;">${escapeHtml(d.name)}</td>
              <td style="padding: 8px;">${d.ip_address ? `<code>${escapeHtml(d.ip_address)}</code>` : '—'}</td>
              <td style="padding: 8px;">${statusBadge(d.status, d)}</td>
            </tr>
          `;
        }).join('');
      }

      updateSelectedCount();
      updateHeaderCheckbox();
    }

    function updateSelectedCount() {
      const count = Object.values(window._exportSelection).filter(Boolean).length;
      selectedCountSpan.textContent = `Выбрано устройств для экспорта: ${count}`;
    }

    function updateHeaderCheckbox() {
      if (filteredDevices.length === 0) {
        chkHeader.checked = false;
        return;
      }
      chkHeader.checked = filteredDevices.every(d => !!window._exportSelection[d.id]);
    }

    filterSettlement.addEventListener('change', updateTable);
    filterStatus.addEventListener('change', updateTable);
    filterType.addEventListener('change', updateTable);
    filterOs.addEventListener('change', updateTable);

    tableBody.addEventListener('change', (e) => {
      if (e.target.classList.contains('export-row-chk')) {
        const id = parseInt(e.target.dataset.id);
        if (e.target.checked) {
          window._exportSelection[id] = true;
        } else {
          delete window._exportSelection[id];
        }
        updateSelectedCount();
        updateHeaderCheckbox();
      }
    });

    chkHeader.addEventListener('change', (e) => {
      const checked = e.target.checked;
      filteredDevices.forEach(d => {
        if (checked) {
          window._exportSelection[d.id] = true;
        } else {
          delete window._exportSelection[d.id];
        }
      });
      updateTable();
    });

    document.getElementById('btnExportSelectVisible').addEventListener('click', () => {
      filteredDevices.forEach(d => { window._exportSelection[d.id] = true; });
      updateTable();
    });

    document.getElementById('btnExportDeselectVisible').addEventListener('click', () => {
      filteredDevices.forEach(d => { delete window._exportSelection[d.id]; });
      updateTable();
    });

    document.getElementById('btnExportClearAll').addEventListener('click', () => {
      window._exportSelection = {};
      updateTable();
    });

    document.getElementById('btnDownloadExcel').addEventListener('click', async () => {
      const selectedIds = Object.keys(window._exportSelection).filter(k => window._exportSelection[k]);
      if (selectedIds.length === 0) {
        alert('Вы не выбрали ни одного устройства для экспорта!');
        return;
      }
      const devicesToExport = devices.filter(d => window._exportSelection[d.id]);
      await exportDevicesToExcelFile(devicesToExport, 'Выгрузка_Техники');
    });

    updateTable();
  } catch (e) {
    view.innerHTML = `<div class="alert alert-danger" style="color: red; padding: 20px;">Ошибка загрузки страницы экспорта: ${escapeHtml(e.message)}</div>`;
  }
}

// ================ История =======================
async function loadDeviceHistory(deviceId) {
  try {
    const history = await api(`/api/devices/${deviceId}/history`);
    if (!history || history.length === 0) {
      return '<div style="color:var(--ink-dim); font-size:13px;">История изменений пуста</div>';
    }
    return `
      <div class="device-history-list" style="margin-top: 15px; border-top: 1px solid var(--border); padding-top: 10px;">
        <h4 style="margin-bottom: 8px; font-size: 14px;">История изменений</h4>
        <div style="max-height: 200px; overflow-y: auto;">
          ${history.map(h => `
            <div style="font-size: 12px; padding: 6px 0; border-bottom: 1px solid var(--border-light); display:flex; justify-content:space-between; align-items:flex-start;">
              <div>
                <span style="color:var(--ink-dim);">${fmtDate(h.created_at)}</span> — 
                <span>${escapeHtml(h.description)}</span>
              </div>
              <span class="badge" style="font-size:10px; margin-left:8px;">${escapeHtml(h.action)}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  } catch (e) {
    return '<div style="color:var(--warn); font-size:13px;">Не удалось загрузить историю</div>';
  }
}