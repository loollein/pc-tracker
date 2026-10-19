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
const TYPE_LABELS = { pc: 'ПК', printer: 'Принтер', mfu: 'МФУ', network: 'Сетевые устройства', spm: 'СПМ', sempl: 'другое'};

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function statusBadge(status) {
  return `<span class="badge ${status}">${STATUS_LABELS[status] || status}</span>`;
}
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const view = document.getElementById('view');
const modalRoot = document.getElementById('modalRoot');
let statusChartInstance = null;

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
      await onSubmit(data);
      closeModal();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
    }
  });
}

// ==================== Баннер "на ремонте" ====================
async function loadRepairBanner() {
  try {
    const devices = await api('/api/devices?status=repair');
    const banner = document.getElementById('repairBanner');
    if (devices.length === 0) { banner.classList.add('hidden'); return; }
    banner.classList.remove('hidden');
    banner.innerHTML = `⚠️ <strong>${devices.length}</strong> устройств${devices.length === 1 ? 'о' : 'а'} сейчас на ремонте.
      <a href="#/devices?status=repair">Посмотреть список →</a>`;
  } catch (e) { /* тихо игнорируем, чтобы не мешать работе */ }
}

async function loadSidebarTotal() {
  try {
    const data = await api('/api/dashboard');
    document.getElementById('sidebarTotal').textContent = data.totals.total_devices || 0;
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
    } else if (segments[0] === 'export') { // Export in Exel JS Route
      setActiveNav('export');
      await renderExport();
    } else if (segments[0] === 'kb') {
      setActiveNav('kb');
      await renderKbPage(); // Функция, которая отрисует верстку и вызовет initKnowledgeBase()
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

// ==================== Дашборд ====================
async function renderDashboard() {
  view.innerHTML = '<div class="empty-state">Загрузка…</div>';
  const data = await api('/api/dashboard');
  const t = data.totals;

  view.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Дашборд</h1>
        <p class="subtitle">Сводка по всем муниципальным филиалам и населённым пунктам</p>
      </div>
    </div>

    <div class="stat-grid">
      <div class="stat-card"><div class="num">${t.total_devices || 0}</div><div class="label">Всего устройств</div></div>
      <div class="stat-card"><div class="num">${t.total_pc || 0}</div><div class="label">ПК</div></div>
      <div class="stat-card"><div class="num">${t.total_printers || 0}</div><div class="label">Принтеры</div></div>
      <div class="stat-card"><div class="num">${t.total_mfu || 0}</div><div class="label">МФУ</div></div>
      <div class="stat-card"><div class="num">${t.total_network || 0}</div><div class="label">Сетевые устройства</div></div>
      <div class="stat-card"><div class="num">${t.total_spm || 0}</div><div class="label">СПМ</div></div>
      <div class="stat-card"><div class="num">${t.total_sempl || 0}</div><div class="label">другое</div></div>
      <div class="stat-card ok"><div class="num">${t.total_working || 0}</div><div class="label">Работают</div></div>
      <div class="stat-card warn"><div class="num">${t.total_repair || 0}</div><div class="label">На ремонте</div></div>
      <div class="stat-card off"><div class="num">${t.total_decommissioned || 0}</div><div class="label">Списаны</div></div>
    </div>

    <div style="display:flex; flex-wrap:wrap; gap:20px; margin-bottom: 20px;">
      
      <div class="panel" style="flex:1; min-width:300px; display:flex; align-items:center; gap:20px;">
        <div style="flex:1; max-width:120px;">
          <canvas id="statusChart" width="300" height="300"></canvas>
        </div>
        <div style="flex:1; min-width:150px;">
          <h3 style="margin-top:0;">Распределение по статусам</h3>
          <ul style="list-style:none; padding:0; font-size:14px;">
            <li style="margin-bottom: 4px;"><span style="display:inline-block; width:12px; height:12px; background:#1a8f4c; border-radius:50%; margin-right:8px;"></span> Работает: <strong>${t.total_working}</strong></li>
            <li style="margin-bottom: 4px;"><span style="display:inline-block; width:12px; height:12px; background:#b8730a; border-radius:50%; margin-right:8px;"></span> На ремонте: <strong>${t.total_repair}</strong></li>
            <li><span style="display:inline-block; width:12px; height:12px; background:#6b7488; border-radius:50%; margin-right:8px;"></span> Списан: <strong>${t.total_decommissioned}</strong></li>
          </ul>
        </div>
      </div>

      <div class="panel" style="flex:1; min-width:300px;">
        <h3 style="margin-top:0;">Операционные системы</h3>
        <div style="font-size:14px; max-height: 140px; overflow-y: auto; padding-right: 10px;">
          ${data.osStats.map(o => `
            <a href="#/export?os=${encodeURIComponent(o.os_name)}" style="display:flex; justify-content:space-between; align-items:center; padding:6px 0; border-bottom:1px solid var(--line); text-decoration:none; color:inherit; cursor:pointer;">
              <span style="display:flex; align-items:center; gap:8px;">
                <span style="display:inline-block; width:8px; height:8px; background:var(--primary); border-radius:50%;"></span>
                ${escapeHtml(o.os_name)}
              </span>
              <strong>${o.count}</strong>
            </a>
          `).join('') || '<div class="empty-state" style="padding:0; font-size:13px;">Нет данных об ОС</div>'}
        </div>
      </div>

    </div>

    <div class="panel">
      <h2>По муниципальным филиалам</h2>
      ${renderBranchStatsTable(data.byMunicipalBranch)}
    </div>

    <div class="panel">
      <h2>По населённым пунктам</h2>
      ${renderSettlementStatsTable(data.bySettlement)}
    </div>
  `;

  // Создаём диаграмму статусов
  const ctx = document.getElementById('statusChart');
  if (ctx) {
    if (typeof statusChartInstance !== 'undefined' && statusChartInstance) {
      statusChartInstance.destroy(); // Очищаем старый график (защита от утечек)
    }
    
    // Используем window, чтобы сделать переменную глобальной и избежать ошибки "not defined"
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

function renderBranchStatsTable(branches) {
  if (!branches || branches.length === 0) {
    return '<div class="empty-state">Нет данных по филиалам</div>';
  }
  return `
    <div class="table-container" style="overflow-x: auto;">
      <table class="table" style="width:100%; border-collapse: collapse;">
        <thead>
          <tr>
            <th style="text-align:left; padding: 10px;">Филиал</th>
            <th style="padding: 10px;">Всего</th>
            <th style="padding: 10px;">ПК</th>
            <th style="padding: 10px;">Принтеры</th>
            <th style="padding: 10px;">МФУ</th>
            <th style="padding: 10px;">Сеть</th>
            <th style="padding: 10px;">другое</th>
            <th style="padding: 10px;">СПМ</th>
            <th style="padding: 10px;">Работают</th>
            <th style="padding: 10px;">Ремонт</th>
            <th style="padding: 10px;">Списаны</th>
          </tr>
        </thead>
        <tbody>
          ${branches.map(b => `
            <tr class="clickable" onclick="location.hash='#/branches/${b.id}'" style="border-bottom: 1px solid var(--line); cursor: pointer;">
              <td style="padding: 8px; font-weight: 500;">${escapeHtml(b.name)}</td>
              <td style="padding: 8px; text-align: center;">${b.devices_count || 0}</td>
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
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderSettlementStatsTable(settlements) {
  if (!settlements || settlements.length === 0) {
    return '<div class="empty-state">Нет данных по населенным пунктам</div>';
  }
  return `
    <div class="table-container" style="overflow-x: auto;">
      <table class="table" style="width:100%; border-collapse: collapse;">
        <thead>
          <tr>
            <th style="text-align:left; padding: 10px;">Населенный пункт</th>
            <th style="text-align:left; padding: 10px;">Филиал</th>
            <th style="padding: 10px;">Всего</th>
            <th style="padding: 10px;">ПК</th>
            <th style="padding: 10px;">Принтеры</th>
            <th style="padding: 10px;">МФУ</th>
            <th style="padding: 10px;">Сеть</th>
            <th style="padding: 10px;">другое</th>
            <th style="padding: 10px;">СПМ</th>
            <th style="padding: 10px;">Работают</th>
            <th style="padding: 10px;">Ремонт</th>
            <th style="padding: 10px;">Списаны</th>
          </tr>
        </thead>
        <tbody>
          ${settlements.map(s => `
            <tr class="clickable" onclick="location.hash='#/branches/${s.municipal_branch_id}'" style="border-bottom: 1px solid var(--line); cursor: pointer;">
              <td style="padding: 8px; font-weight: 500;">${escapeHtml(s.name)}</td>
              <td style="padding: 8px; color: var(--ink-dim);">${escapeHtml(s.municipal_branch_name)}</td>
              <td style="padding: 8px; text-align: center;">${s.devices_count || 0}</td>
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
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ==================== Филиалы: список ====================
// ==================== Филиалы: единый древовидный список ====================
async function renderBranchesList() {
  view.innerHTML = '<div class="empty-state">Загрузка…</div>';
  const [branches, settlements] = await Promise.all([
    api('/api/branches'),
    api('/api/settlements')
  ]);

  view.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Муниципальные филиалы и пункты</h1>
        <p class="subtitle">Иерархическая структура техники по филиалам</p>
      </div>
      <button class="btn primary" id="addBranchBtn">+ Добавить филиал</button>
    </div>

    <div class="toolbar">
      <input type="text" id="branchSearch" placeholder="Поиск филиала или населённого пункта..." style="width:100%; max-width:400px;">
    </div>

    <div class="branches-tree">
      ${branches.length === 0 ? '<div class="empty-state">Филиалов пока нет.</div>' : branches.map(branch => {
        const branchSettlements = settlements.filter(s => s.municipal_branch_id === branch.id);
        return `
          <div class="panel branch-panel" data-branch-id="${branch.id}" style="margin-bottom: 12px; padding: 12px 16px;">
            <div style="display:flex; justify-content:space-between; align-items:center; cursor:pointer;" class="branch-toggle">
              <div>
                <strong>${escapeHtml(branch.name)}</strong> 
                <span style="color:var(--ink-dim); font-size:13px; margin-left:8px;">
                  (${branchSettlements.length} нас. пунктов, ${branch.devices_count || 0} устройств)
                </span>
                ${branch.repair_count ? `<span class="badge repair" style="margin-left:8px;">${branch.repair_count} на ремонте</span>` : ''}
              </div>
              <div style="display:flex; gap:6px;">
                <button class="btn sm" onclick="event.stopPropagation(); openAddSettlementModal(${branch.id})">+ Пункт</button>
                <button class="btn sm" onclick="event.stopPropagation(); openEditBranchModal(${branch.id}, '${escapeHtml(branch.name).replace(/'/g, "\\'")}')">✏️</button>
                <button class="btn sm danger" onclick="event.stopPropagation(); openDeleteBranchModal(${branch.id}, '${escapeHtml(branch.name).replace(/'/g, "\\'")}')">🗑️</button>
              </div>
            </div>
            
            <div class="branch-settlements" style="margin-top: 10px; padding-left: 16px; border-left: 2px solid var(--border); display: none;">
              ${branchSettlements.length === 0 ? '<div style="color:var(--ink-dim); font-size:13px;">Нет населённых пунктов</div>' : 
                branchSettlements.map(s => `
                  <div style="display:flex; justify-content:space-between; align-items:center; padding: 6px 0; border-bottom: 1px solid var(--border-light);">
                    <a href="#/branches/${branch.id}/settlements/${s.id}" style="text-decoration:none; color:var(--ink);">
                      📍 ${escapeHtml(s.name)} <span style="font-size:12px; color:var(--ink-dim);">(${s.devices_count || 0} устр.)</span>
                    </a>
                    <div style="display:flex; gap:4px;">
                      <button class="btn sm" onclick="event.stopPropagation(); openEditSettlementModal(${s.id}, '${escapeHtml(s.name).replace(/'/g, "\\'")}')">✏️</button>
                      <button class="btn sm danger" onclick="event.stopPropagation(); openDeleteSettlementModal(${s.id}, '${escapeHtml(s.name).replace(/'/g, "\\'")}')">🗑️</button>
                    </div>
                  </div>
                `).join('')}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  // Логика сворачивания/разворачивания списка филиала
  document.querySelectorAll('.branch-toggle').forEach(el => {
    el.onclick = (e) => {
      const settlementsContainer = e.currentTarget.nextElementSibling;
      if (settlementsContainer) {
        settlementsContainer.style.display = settlementsContainer.style.display === 'none' ? 'block' : 'none';
      }
    };
  });

  // Живой поиск
  document.getElementById('branchSearch').oninput = (e) => {
    const val = e.target.value.toLowerCase();
    document.querySelectorAll('.branch-panel').forEach(panel => {
      const text = panel.textContent.toLowerCase();
      panel.style.display = text.includes(val) ? 'block' : 'none';
    });
  };

  document.getElementById('addBranchBtn').onclick = () => {
    openModal('Новый муниципальный филиал', `
      <div class="field"><label>Название филиала</label><input name="name" required autofocus></div>
    `, async (data) => {
      await api('/api/branches', { method: 'POST', body: JSON.stringify({ name: data.name }) });
      router();
    }, 'Добавить');
  };
}

// ==================== Вспомогательные функции для модалок в филиалах ====================
function openAddSettlementModal(branchId) {
  openModal('Новый населённый пункт', `
    <div class="field"><label>Название</label><input name="name" required autofocus placeholder="Например: г. Заречное"></div>
  `, async (data) => {
    await api(`/api/branches/${branchId}/settlements`, { method: 'POST', body: JSON.stringify({ name: data.name }) });
    router();
  }, 'Добавить');
}

function openEditBranchModal(branchId, currentName) {
  openModal('Переименовать филиал', `
    <div class="field"><label>Название филиала</label><input name="name" required value="${escapeHtml(currentName)}"></div>
  `, async (data) => {
    await api(`/api/branches/${branchId}`, { method: 'PUT', body: JSON.stringify({ name: data.name }) });
    router();
  });
}

function openDeleteBranchModal(branchId, branchName) {
  if (confirm(`Удалить филиал «${branchName}» вместе со всеми населёнными пунктами и устройствами? Это необратимо.`)) {
    api(`/api/branches/${branchId}`, { method: 'DELETE' }).then(() => router());
  }
}

function openEditSettlementModal(settlementId, currentName) {
  openModal('Переименовать населённый пункт', `
    <div class="field"><label>Название</label><input name="name" required value="${escapeHtml(currentName)}"></div>
  `, async (data) => {
    await api(`/api/settlements/${settlementId}`, { method: 'PUT', body: JSON.stringify({ name: data.name }) });
    router();
  });
}

function openDeleteSettlementModal(settlementId, settlementName) {
  if (confirm(`Удалить населённый пункт «${settlementName}» вместе со всеми устройствами? Это необратимо.`)) {
    api(`/api/settlements/${settlementId}`, { method: 'DELETE' }).then(() => router());
  }
}
function branchCard(b) {
  return `
    <a class="card-item" href="#/branches/${b.id}">
      <div class="title">${escapeHtml(b.name)}</div>
      <div class="meta">
        <span>${b.settlements_count || 0} нас. пунктов</span>
        <span>${b.devices_count || 0} устройств</span>
        ${b.repair_count ? `<span style="color:var(--warn)">${b.repair_count} на ремонте</span>` : ''}
      </div>
    </a>
  `;
}

// ==================== Населённые пункты внутри филиала ====================
async function renderSettlementsList(branchId) {
  view.innerHTML = '<div class="empty-state">Загрузка…</div>';
  const [branch, settlements] = await Promise.all([
    api(`/api/branches/${branchId}`),
    api(`/api/branches/${branchId}/settlements`),
  ]);

  view.innerHTML = `
    <div class="breadcrumb"><a href="#/branches">Филиалы</a> / ${escapeHtml(branch.name)}</div>
    <div class="page-header">
      <div>
        <h1>${escapeHtml(branch.name)}</h1>
        <p class="subtitle">Населённые пункты этого филиала</p>
      </div>
      <div style="display:flex; gap:8px;">
        <button class="btn" id="renameBranchBtn">Переименовать</button>
        <button class="btn danger" id="deleteBranchBtn">Удалить филиал</button>
        <button class="btn primary" id="addSettlementBtn">+ Добавить пункт</button>
      </div>
    </div>
    ${settlements.length === 0
      ? '<div class="empty-state">В этом филиале пока нет населённых пунктов.</div>'
      : `<div class="card-list">${settlements.map((s) => settlementCard(s, branchId)).join('')}</div>`}
  `;

  document.getElementById('addSettlementBtn').onclick = () => {
    openModal('Новый населённый пункт', `
      <div class="field"><label>Название</label><input name="name" required autofocus placeholder="Например: г. Заречное"></div>
    `, async (data) => {
      await api(`/api/branches/${branchId}/settlements`, { method: 'POST', body: JSON.stringify({ name: data.name }) });
      router();
    }, 'Добавить');
  };
  document.getElementById('renameBranchBtn').onclick = () => {
    openModal('Переименовать филиал', `
      <div class="field"><label>Название филиала</label><input name="name" required value="${escapeHtml(branch.name)}"></div>
    `, async (data) => {
      await api(`/api/branches/${branchId}`, { method: 'PUT', body: JSON.stringify({ name: data.name }) });
      router();
    });
  };
  document.getElementById('deleteBranchBtn').onclick = async () => {
    if (!confirm(`Удалить филиал «${branch.name}» вместе со всеми населёнными пунктами и устройствами? Это необратимо.`)) return;
    await api(`/api/branches/${branchId}`, { method: 'DELETE' });
    location.hash = '#/branches';
  };
}
function settlementCard(s, branchId) {
  return `
    <a class="card-item" href="#/branches/${branchId}/settlements/${s.id}">
      <div class="title">${escapeHtml(s.name)}</div>
      <div class="meta">
        <span>${s.devices_count || 0} устройств</span>
        ${s.repair_count ? `<span style="color:var(--warn)">${s.repair_count} на ремонте</span>` : ''}
      </div>
    </a>
  `;
}

// ==================== Устройства внутри населённого пункта ====================
async function renderDevicesOfSettlement(branchId, settlementId) {
  view.innerHTML = '<div class="empty-state">Загрузка…</div>';
  const [branch, settlement, devices] = await Promise.all([
    api(`/api/branches/${branchId}`),
    api(`/api/settlements/${settlementId}`),
    api(`/api/settlements/${settlementId}/devices`),
  ]);

  view.innerHTML = `
    <div class="breadcrumb"><a href="#/branches">Филиалы</a> / <a href="#/branches/${branchId}">${escapeHtml(branch.name)}</a> / ${escapeHtml(settlement.name)}</div>
    <div class="page-header">
      <div>
        <h1>${escapeHtml(settlement.name)}</h1>
        <p class="subtitle">ПК и принтеры этого населённого пункта</p>
      </div>
      <div style="display:flex; gap:8px;">
        <button class="btn" id="renameSettlementBtn">Переименовать</button>
        <button class="btn danger" id="deleteSettlementBtn">Удалить пункт</button>
        <button class="btn primary" id="addDeviceBtn">+ Добавить устройство</button>
      </div>
    </div>
    ${devicesTable(devices, { showLocation: false })}
  `;

  bindDeviceRowActions(devices, () => renderDevicesOfSettlement(branchId, settlementId));

  document.getElementById('addDeviceBtn').onclick = () => openDeviceForm(null, async (data) => {
    await api(`/api/settlements/${settlementId}/devices`, { method: 'POST', body: JSON.stringify(data) });
    router();
  });
  document.getElementById('renameSettlementBtn').onclick = () => {
    openModal('Переименовать населённый пункт', `
      <div class="field"><label>Название</label><input name="name" required value="${escapeHtml(settlement.name)}"></div>
    `, async (data) => {
      await api(`/api/settlements/${settlementId}`, { method: 'PUT', body: JSON.stringify({ name: data.name }) });
      router();
    });
  };
  document.getElementById('deleteSettlementBtn').onclick = async () => {
    if (!confirm(`Удалить населённый пункт «${settlement.name}» вместе со всеми устройствами? Это необратимо.`)) return;
    await api(`/api/settlements/${settlementId}`, { method: 'DELETE' });
    location.hash = `#/branches/${branchId}`;
  };
}

// ==================== Все устройства (глобальный список) ====================
async function renderAllDevices(query) {
  view.innerHTML = '<div class="empty-state">Загрузка…</div>';
  
  // Загружаем данные один раз
  let [allDevices, branches, settlements] = await Promise.all([
    api('/api/devices'),
    api('/api/branches'),
    api('/api/settlements')
  ]);

  // Отрисовка шапки и тулбара с кнопками и фильтрами
  view.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Все устройства</h1>
        <p class="subtitle">Полный список ПК и принтеров по всем филиалам</p>
      </div>
    </div>
    <div class="toolbar" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; align-items: center; margin-bottom: 20px;">
      
      <!-- Кнопки действий -->
      <button class="btn primary" id="importBtn" style="grid-column: 1 / -1; width: max-content; margin-bottom: 5px;">⬆ Импорт из Excel</button>
      <button class="btn" id="moveDevicesBtn" style="display: none; grid-column: 1 / -1; width: max-content; margin-bottom: 5px; background: #d97706; color: white;">🔄 Переместить выбранные (<span id="selectedCount">0</span>)</button>
      
      <!-- Фильтры -->
      <input type="text" id="searchInput" placeholder="Поиск по всем полям..." value="${escapeHtml(query.q || '')}" style="width: 100%;">
      
      <select id="branchFilter" style="width: 100%;">
        <option value="">Все филиалы</option>
        ${branches.map(b => `<option value="${b.id}" ${query.branch == b.id ? 'selected' : ''}>${escapeHtml(b.name)}</option>`).join('')}
      </select>
      
      <select id="settlementFilter" style="width: 100%;">
        <option value="">Все нас. пункты</option>
        ${settlements.map(s => `<option value="${s.id}" data-branch="${s.municipal_branch_id}" ${query.settlement == s.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
      </select>

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
        <option value="Astra Linux" ${query.os === 'Astra Linux' ? 'selected' : ''}>Astra Linux</option>
        <option value="Red OS" ${query.os === 'Red OS' ? 'selected' : ''}>Red OS</option>
        <option value="ALT Linux" ${query.os === 'ALT Linux' ? 'selected' : ''}>ALT Linux</option>
        <option value="Win 7" ${query.os === 'Win 7' ? 'selected' : ''}>Win 7</option>
        <option value="Win 10" ${query.os === 'Win 10' ? 'selected' : ''}>Win 10</option>
        <option value="другое" ${query.os === 'другое' ? 'selected' : ''}>другое</option>
      </select>
    </div>
    <div class="devices-table-wrapper"></div>
  `;

  // Получаем ссылки на элементы
  const searchInput = document.getElementById('searchInput');
  const branchFilter = document.getElementById('branchFilter');
  const settlementFilter = document.getElementById('settlementFilter');
  const statusFilter = document.getElementById('statusFilter');
  const typeFilter = document.getElementById('typeFilter');
  const osFilter = document.getElementById('osFilter');
  const moveDevicesBtn = document.getElementById('moveDevicesBtn');
  const wrapper = document.querySelector('.devices-table-wrapper');

  // Логика взаимосвязи: при выборе филиала показываем только его населенные пункты
  branchFilter.addEventListener('change', () => {
    const selectedBranch = branchFilter.value;
    const options = settlementFilter.querySelectorAll('option');
    
    options.forEach(opt => {
      if (opt.value === "") return;
      if (!selectedBranch || opt.dataset.branch === selectedBranch) {
        opt.style.display = '';
      } else {
        opt.style.display = 'none';
      }
    });

    if (settlementFilter.options[settlementFilter.selectedIndex] && settlementFilter.options[settlementFilter.selectedIndex].style.display === 'none') {
      settlementFilter.value = "";
    }
    refreshTable();
  });

  // Функция локальной фильтрации и перерисовки таблицы
  const refreshTable = () => {
    const q = searchInput.value.trim().toLowerCase();
    const branchVal = branchFilter.value;
    const settlementVal = settlementFilter.value;
    const statusVal = statusFilter.value;
    const typeVal = typeFilter.value;
    const osVal = osFilter.value;

    const filteredDevices = allDevices.filter(d => {
      if (branchVal && String(d.municipal_branch_id) !== branchVal) return false;
      if (settlementVal && String(d.settlement_branch_id) !== settlementVal) return false;
      if (statusVal && d.status !== statusVal) return false;
      if (typeVal && d.type !== typeVal) return false;
      if (osVal && d.os !== osVal) return false;

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
      });
      // При перерисовке сбрасываем видимость кнопки перемещения
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
    
    const newHash = '#/devices' + (p.toString() ? '?' + p.toString() : '');
    if (history.replaceState) history.replaceState(null, null, newHash);
  };

  // Слушатели для фильтров
  let searchTimeout;
  searchInput.oninput = () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(refreshTable, 350);
  };
  settlementFilter.addEventListener('change', refreshTable);
  statusFilter.addEventListener('change', refreshTable);
  typeFilter.addEventListener('change', refreshTable);
  osFilter.addEventListener('change', refreshTable);

  // Инициализация при первой загрузке
  if (query.branch) branchFilter.dispatchEvent(new Event('change'));
  refreshTable();

  // ==================== ЛОГИКА ЧЕКБОКСОВ И ПЕРЕМЕЩЕНИЯ ====================
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
    const selectedIds = Array.from(wrapper.querySelectorAll('.device-checkbox:checked')).map(cb => cb.value);
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
        alert('Пожалуйста, выберите филиал и населенный пункт.');
        return false; 
      }

      const confirmMsg = `Вы уверены, что хотите переместить ${selectedIds.length} устройств(а)?`;
      if (!confirm(confirmMsg)) return;

      try {
        const originalBtnText = moveDevicesBtn.innerHTML;
        moveDevicesBtn.textContent = 'Идет перемещение...';
        moveDevicesBtn.disabled = true;

        for (const id of selectedIds) {
           const device = allDevices.find(d => String(d.id) === String(id));
           if(device) {
               await api(`/api/devices/${id}`, {
                   method: 'PUT', 
                   body: JSON.stringify({
                       settlement_branch_id: newSettlement,
                       type: device.type,
                       inventory_number: device.inventory_number,
                       name: device.name,
                       ip_address: device.ip_address,
                       os: device.os,
                       software: device.software,
                       security: device.security,
                       domain_joined: device.domain_joined,
                       notes: device.notes,
                       status: device.status
                   })
               });
           }
        }

        allDevices = await api('/api/devices');
        refreshTable();
        
        moveDevicesBtn.style.display = 'none';
        moveDevicesBtn.disabled = false;
        moveDevicesBtn.innerHTML = originalBtnText;

      } catch (error) {
         alert('Ошибка при перемещении: ' + error.message);
         moveDevicesBtn.disabled = false;
      }
    });

    const moveBranchSelect = document.getElementById('moveBranchSelect');
    const moveSettlementSelect = document.getElementById('moveSettlementSelect');
    
    moveBranchSelect.onchange = () => {
      const bId = moveBranchSelect.value;
      if (!bId) {
        moveSettlementSelect.innerHTML = '<option value="">Сначала выберите филиал...</option>';
        return;
      }
      moveSettlementSelect.innerHTML = '<option value="">Выберите нас. пункт...</option>' + 
        settlements.filter(s => String(s.municipal_branch_id) === String(bId))
                   .map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
    };
  };

  // ==================== ЛОГИКА ИМПОРТА ====================
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
        
        allDevices = await api('/api/devices');
        refreshTable();
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
        <th style="width:80px;">IP-адрес</th>
        <th style="width:80px;">ОС</th>
        <th style="width:80px;">Софт</th>
        <th style="width:80px;">СЗИ</th>
        <th style="width:80px;">Ввод в домен</th>
        ${showLocation ? '<th style="width:80px;">Расположение</th>' : ''}
        <th style="width:80px;">Примечание</th>
        <th style="width:80px;">Статус</th>
        <th style="width:80px;"></th>
      </tr></thead>
      <tbody>
        ${devices.map((d) => `
          <tr data-device-id="${d.id}">
            <td style="text-align: center;"><input type="checkbox" class="device-checkbox" value="${d.id}"></td>
            <td>${TYPE_LABELS[d.type] || d.type}</td>
            <td class="mono">${escapeHtml(d.inventory_number)}</td>
            <td>${escapeHtml(d.name)}</td>
            <td class="mono">${d.ip_address ? escapeHtml(d.ip_address) : '—'}</td>
            <td>${escapeHtml(d.os) || '—'}</td>
            <td>${escapeHtml(d.software) || '—'}</td>
            <td>${escapeHtml(d.security) || '—'}</td>
            <td>${escapeHtml(d.domain_joined) || '—'}</td>
            ${showLocation ? `<td>${escapeHtml(d.branch_name)} / ${escapeHtml(d.settlement_name)}</td>` : ''}
            <td>${escapeHtml(d.notes) || '—'}</td>
            <td>${statusBadge(d.status)}</td>
            <td style="white-space:nowrap;">
              <button class="btn small edit-device-btn">Изменить</button>
              <button class="btn small danger delete-device-btn">Удалить</button>
            </td>
          </tr>
        `).join('')}
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
      if (!confirm(`Удалить устройство «${device.name}» (инв. № ${device.inventory_number})?`)) return;
      await api(`/api/devices/${id}`, { method: 'DELETE' });
      onChange();
    };
  });
}

// ==================== Форма устройства (добавление/редактирование) ====================
function openDeviceForm(device, onSubmit) {
  const isEdit = !!device;
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
      <input name="name" required value="${escapeHtml(device?.name || '')}" placeholder="Например: ПК бухгалтерии">
    </div>
    <div class="field">
      <label>IP-адрес (для удалённого подключения)</label>
      <input name="ip_address" value="${escapeHtml(device?.ip_address || '')}" placeholder="192.168.1.10">
    </div>
    <div class="field">
  <label>Операционная система</label>
  <select name="os">
    <option value="">— Не указано —</option>
    <option value="Astra Linux" ${device?.os === 'Astra Linux' ? 'selected' : ''}>Astra Linux</option>
    <option value="Red OS" ${device?.os === 'Red OS' ? 'selected' : ''}>Red OS</option>
    <option value="ALT Linux" ${device?.os === 'ALT Linux' ? 'selected' : ''}>ALT Linux</option>
    <option value="Win 7" ${device?.os === 'Win 7' ? 'selected' : ''}>Win 7</option>
    <option value="Win 10" ${device?.os === 'Win 10' ? 'selected' : ''}>Win 10</option>
    <option value="другое" ${device?.os === 'другое' ? 'selected' : ''}>другое</option>
  </select>
  </div>

  <div class="field">
    <label>Софт (установленное ПО)</label>
    <input name="software" value="${escapeHtml(device?.software || '')}" placeholder="Например: 1С, MS Office...">
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

  // Асинхронно подгружаем историю, если это редактирование существующего устройства
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

// Глобальные хранилища (инициализируем ДО использования)
if (typeof window._exportSelection === 'undefined') {
  window._exportSelection = {};
}
if (typeof window._exportCollapsed === 'undefined') {
  window._exportCollapsed = {};
}

async function renderExport() {
  try {
    // Получаем устройства, филиалы И населенные пункты
    const [devices, branches, settlements] = await Promise.all([
      api('/api/devices'),
      api('/api/branches'),
      api('/api/settlements')
    ]);

    if (typeof window._exportSelection === 'undefined') {
      window._exportSelection = {};
    }

    // Очистим несуществующие девайсы из сессии выбора, если они там были
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
            <select id="exportFilterSettlement" class="form-control" style="width: 100%; padding: 6px; border-radius: 4px; border: 1px solid #ccc;">
              <option value="">Все населенные пункты</option>
              ${settlements.map(s => `<option value="${s.id}" data-branch="${s.municipal_branch_id}">${escapeHtml(s.name)}</option>`).join('')}
            </select>
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
              <option value="Astra Linux">Astra Linux</option>
              <option value="Red OS">Red OS</option>
              <option value="ALT Linux">ALT Linux</option>
              <option value="Win 7">Win 7</option>
              <option value="Win 10">Win 10</option>
              <option value="другое">другое</option>
            </select>
          </div>
        </div>
        

        <div style="display: flex; gap: 10px; align-items: center; margin-bottom: 15px; flex-wrap: wrap;">
          <button id="btnExportSelectVisible" class="btn btn-secondary btn-sm" style="padding:6px 12px; cursor:pointer;">Выбрать отфильтрованные</button>
          <button id="btnExportDeselectVisible" class="btn btn-secondary btn-sm" style="padding:6px 12px; cursor:pointer;">Снять выбор с видимых</button>
          <button id="btnExportClearAll" class="btn btn-danger btn-sm" style="background-color: #dc3545; border:none; color: white; padding:6px 12px; border-radius:4px; cursor:pointer;">Сбросить весь выбор</button>
          <span id="exportSelectedCount" style="margin-left: auto; font-weight: 500; color: #333;">Выбрано устройств: 0</span>
        </div>

        <div class="table-container" style=" overflow-y: auto;">
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
            <tbody id="exportTableBody">
              </tbody>
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

    // Считываем параметр ОС из адресной строки (если перешли с дашборда)
    const currentHash = window.location.hash;
    if (currentHash.includes('?')) {
      const urlParams = new URLSearchParams(currentHash.split('?')[1]);
      if (urlParams.has('os')) {
        filterOs.value = urlParams.get('os');
      }
    }

    // Умная логика для фильтра "Населенный пункт" при выборе филиала
    filterBranch.addEventListener('change', () => {
      const selectedBranch = filterBranch.value;
      const options = filterSettlement.querySelectorAll('option');
      
      options.forEach(opt => {
        if (opt.value === "") return; // Оставляем пункт "Все населенные пункты"
        
        // Если филиал не выбран или ID филиала совпадает с data-branch у опции
        if (!selectedBranch || opt.dataset.branch === selectedBranch) {
          opt.style.display = '';
        } else {
          opt.style.display = 'none';
        }
      });

      // Если выбранный в данный момент населенный пункт скрылся (не из этого филиала), сбрасываем его
      const currentOpt = filterSettlement.options[filterSettlement.selectedIndex];
      if (currentOpt && currentOpt.style.display === 'none') {
        filterSettlement.value = "";
      }
      
      updateTable();
    });

    // Функция фильтрации устройств и перерисовки таблицы
    function updateTable() {
      const branchVal = filterBranch.value;
      const settlementVal = filterSettlement.value;
      const statusVal = filterStatus.value;
      const typeVal = filterType.value;
      const osVal = filterOs.value; // <-- Добавили получение значения ОС

      filteredDevices = devices.filter(d => {
        const matchesBranch = !branchVal || d.municipal_branch_id === parseInt(branchVal);
        const matchesSettlement = !settlementVal || d.settlement_branch_id === parseInt(settlementVal);
        const matchesStatus = !statusVal || d.status === statusVal;
        const matchesType = !typeVal || d.type === typeVal;
        const matchesOs = !osVal || d.os === osVal; // <-- Добавили проверку по ОС
        return matchesBranch && matchesSettlement && matchesStatus && matchesType && matchesOs; // <-- Добавили в итоговое условие
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
              <td style="padding: 8px;">${statusBadge(d.status)}</td>
            </tr>
          `;
        }).join('');
      }

      updateSelectedCount();
      updateHeaderCheckbox();
    }

    // Обновление счетчика
    function updateSelectedCount() {
      const count = Object.values(window._exportSelection).filter(Boolean).length;
      selectedCountSpan.textContent = `Выбрано устройств для экспорта: ${count}`;
    }

    // Обновление чекбокса в шапке
    function updateHeaderCheckbox() {
      if (filteredDevices.length === 0) {
        chkHeader.checked = false;
        return;
      }
      chkHeader.checked = filteredDevices.every(d => !!window._exportSelection[d.id]);
    }

    // Слушатели событий изменения остальных фильтров
    filterSettlement.addEventListener('change', updateTable);
    filterStatus.addEventListener('change', updateTable);
    filterType.addEventListener('change', updateTable);
    filterOs.addEventListener('change', updateTable);

    // Логика клика по чекбоксу конкретного устройства
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

    // Логика клика по общему чекбоксу в шапке
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

    // Кнопка "Выбрать отфильтрованные"
    document.getElementById('btnExportSelectVisible').addEventListener('click', () => {
      filteredDevices.forEach(d => { window._exportSelection[d.id] = true; });
      updateTable();
    });

    // Кнопка "Снять выбор с видимых"
    document.getElementById('btnExportDeselectVisible').addEventListener('click', () => {
      filteredDevices.forEach(d => { delete window._exportSelection[d.id]; });
      updateTable();
    });

    // Кнопка "Сбросить весь выбор"
    document.getElementById('btnExportClearAll').addEventListener('click', () => {
      window._exportSelection = {};
      updateTable();
    });

    // =========================================================
    // ЛОГИКА СКАЧИВАНИЯ EXCEL (ExcelJS + FileSaver)
    // =========================================================
    document.getElementById('btnDownloadExcel').addEventListener('click', async () => {
      // 1. Собираем ID, у которых стоит true
      const selectedIds = Object.keys(window._exportSelection).filter(k => window._exportSelection[k]);
      
      if (selectedIds.length === 0) {
        alert('Вы не выбрали ни одного устройства для экспорта!');
        return;
      }

      // 2. Фильтруем оригинальный массив устройств, оставляя только выбранные
      const devicesToExport = devices.filter(d => window._exportSelection[d.id]);

      // 3. Создаем книгу и лист Excel
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

      // 4. Заполняем данными
      devicesToExport.forEach(d => {
        const row = worksheet.addRow([
          d.branch_name || '',
          d.settlement_name || '',
          TYPE_LABELS[d.type] || d.type,
          d.inventory_number,
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

      // 5. Автоширина колонок
      worksheet.columns.forEach((col, index) => {
        let maxLength = 0;
        col.eachCell({ includeEmpty: true }, (cell) => {
          const value = cell.value ? cell.value.toString() : '';
          maxLength = Math.max(maxLength, value.length);
        });
        col.width = Math.min(50, Math.max(12, maxLength + 2));
      });

      // 6. Формируем бинарный файл и скачиваем
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      
      // Имя файла с текущей датой
      const fname = `Выгрузка_Техники_${new Date().toISOString().slice(0,10)}.xlsx`;
      saveAs(blob, fname);
    });

    // Инициализация таблицы при открытии вкладки
    updateTable();

  } catch (e) {
    view.innerHTML = `<div class="alert alert-danger" style="color: red; padding: 20px;">Ошибка загрузки страницы экспорта: ${escapeHtml(e.message)}</div>`;
  }
}

async function doExportWithSelection(settlements) {
  const allDevices = await api('/api/devices');
  if (!allDevices || !Array.isArray(allDevices)) {
    alert('Не удалось получить список устройств.');
    return;
  }

  const selectedIds = Object.keys(window._exportSelection).filter(k => window._exportSelection[k]);
  const targetSettlementIds = selectedIds.length === 0
    ? settlements.map(s => String(s.id))
    : selectedIds.map(String);

  const devicesToExport = allDevices.filter(d =>
    targetSettlementIds.includes(String(d.settlement_branch_id))
  );

  if (devicesToExport.length === 0) {
    alert('Нет устройств для экспорта по выбранным критериям.');
    return;
  }

  // Создаём книгу Excel с помощью exceljs
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Устройства');

  // Заголовки (жирный шрифт, выравнивание по центру)
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

  // Заполняем данные
  devicesToExport.forEach(d => {
    const row = worksheet.addRow([
      d.branch_name || '',
      d.settlement_name || '',
      TYPE_LABELS[d.type] || d.type,
      d.inventory_number,
      d.name,
      d.ip_address || '',
      d.os || '',
      d.software || '',
      d.security || '',
      d.domain_joined || '',
      d.notes || '',
      STATUS_LABELS[d.status] || d.status,
    ]);
    // Выравнивание для всех ячеек данных (по вертикали – по центру, по горизонтали – по умолчанию)
    row.alignment = { vertical: 'middle', wrapText: true };
    // Для столбцов с длинным текстом (Примечание) включаем перенос
    row.getCell(7).alignment = { vertical: 'middle', wrapText: true };
  });

  // Автоматическая ширина колонок (на основе максимальной длины текста в каждой колонке)
  worksheet.columns.forEach((col, index) => {
    let maxLength = 0;
    const columnLetter = String.fromCharCode(65 + index); // A, B, C, ...
    col.eachCell({ includeEmpty: true }, (cell) => {
      const value = cell.value ? cell.value.toString() : '';
      maxLength = Math.max(maxLength, value.length);
    });
    // Задаём ширину с небольшим запасом
    col.width = Math.min(50, Math.max(10, maxLength + 4));
  });

  // Генерация файла и скачивание
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const fname = `Инвентаризация_${new Date().toISOString().slice(0,10)}.xlsx`;
  saveAs(blob, fname);
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
              <span class="badge" style="font-size:10px; margin-left:8px;">${h.action}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  } catch (e) {
    return '<div style="color:var(--warn); font-size:13px;">Не удалось загрузить историю</div>';
  }

  let currentDevicePage = 1;
  let isLoadingDevices = false;
  let hasMoreDevices = true;

  async function renderDevicesView() {
  currentDevicePage = 1;
  hasMoreDevices = true;

  // Отрисовываем каркас страницы (тулбар, шапку таблицы и контейнер для строк)
  view.innerHTML = `
    <div class="page-header">
      <h1>Устройства</h1>
    </div>
    <div class="toolbar">
      <input type="text" id="deviceSearch" placeholder="Поиск по устройствам..." style="width:100%; max-width:400px;">
    </div>
    <div class="table-container" style="max-height: 65vh; overflow-y: auto;" id="devicesScrollContainer">
      <table class="data-table" style="width:100%;">
        <thead>
          <tr>
            <th>Инв. номер</th>
            <th>Название</th>
            <th>Филиал / Пункт</th>
            <th>Статус</th>
            <th>Действия</th>
          </tr>
        </thead>
        <tbody id="devicesTableBody">
          </tbody>
      </table>
      <div id="loadingIndicator" style="text-align:center; padding:15px; color:var(--ink-dim); font-size:13px; display:none;">
        Загрузка устройств...
      </div>
    </div>
  `;

  // Загружаем первую порцию
  await loadMoreDevices();

  // Вешаем обработчик скролла на контейнер таблицы
  const container = document.getElementById('devicesScrollContainer');
  container.onscroll = () => {
    // Если до конца скролла осталось менее 100 пикселей, и мы еще не грузим данные, и есть что грузить
    if (container.scrollTop + container.clientHeight >= container.scrollHeight - 100) {
      if (!isLoadingDevices && hasMoreDevices) {
        loadMoreDevices();
      }
    }
  };

  // Живой поиск
  document.getElementById('deviceSearch').oninput = debounce(async (e) => {
    currentDevicePage = 1;
    hasMoreDevices = true;
    document.getElementById('devicesTableBody').innerHTML = '';
    await loadMoreDevices(e.target.value);
  }, 300);
}

  async function loadMoreDevices(searchQuery = '') {
  if (isLoadingDevices || !hasMoreDevices) return;
  isLoadingDevices = true;

  const indicator = document.getElementById('loadingIndicator');
  if (indicator) indicator.style.display = 'block';

  try {
    const queryParams = new URLSearchParams({
      page: currentDevicePage,
      limit: 40, // порция по 40 штук
      ...(searchQuery && { q: searchQuery })
    });

    const res = await api(`/api/devices?${queryParams.toString()}`);
    const { items, totalPages } = res;

    const tbody = document.getElementById('devicesTableBody');

    if (currentDevicePage === 1 && items.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Устройства не найдены</td></tr>';
      hasMoreDevices = false;
      return;
    }

    // Добавляем новые строки в конец таблицы
    const rowsHtml = items.map(d => `
      <tr>
        <td>${escapeHtml(d.inventory_number)}</td>
        <td>${escapeHtml(d.name)}</td>
        <td>${escapeHtml(d.branch_name)} / ${escapeHtml(d.settlement_name)}</td>
        <td>${statusBadge(d.status)}</td>
        <td>
          <button class="btn sm" onclick="openDeviceModal(${JSON.stringify(d).replace(/"/g, '&quot;')})">✏️</button>
        </td>
      </tr>
    `).join('');

    tbody.insertAdjacentHTML('beforeend', rowsHtml);

    // Проверяем, есть ли еще страницы
    if (currentDevicePage >= totalPages) {
      hasMoreDevices = false;
    } else {
      currentDevicePage++;
    }
  } catch (err) {
    console.error('Ошибка загрузки устройств:', err);
  } finally {
    isLoadingDevices = false;
    if (indicator) indicator.style.display = 'none';
  }
  }

  // Вспомогательная функция debounce (чтобы поиск не дергался при каждом нажатии клавиши)
  function debounce(fn, ms) {
    let timeout;
    return function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => fn.apply(this, args), ms);
    };
  }
}