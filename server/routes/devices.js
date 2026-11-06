// server/routes/devices.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { findSubnetConfigByIp, ensureSettlementId } = require('../scanner');

const VALID_TYPES = ['pc', 'printer', 'mfu', 'network', 'spm', 'sempl'];
const VALID_STATUSES = ['working', 'repair', 'decommissioned'];

const STATUS_LABELS = {
  working: 'Работает',
  repair: 'На ремонте',
  decommissioned: 'Списан'
};

const TYPE_LABELS = {
  pc: 'ПК',
  printer: 'Принтер',
  mfu: 'МФУ',
  network: 'Сетевое устройство',
  spm: 'СПМ',
  sempl: 'Другое'
};

const insertHistory = db.prepare(`
  INSERT INTO device_history (device_id, action, description)
  VALUES (?, ?, ?)
`);

function buildDiffDescription(oldDev, newDev) {
  const changes = [];

  if (oldDev.settlement_branch_id !== newDev.settlement_branch_id) {
    const oldSb = db.prepare('SELECT name FROM settlement_branches WHERE id = ?').get(oldDev.settlement_branch_id);
    const newSb = db.prepare('SELECT name FROM settlement_branches WHERE id = ?').get(newDev.settlement_branch_id);
    changes.push(`Нас. пункт: "${oldSb?.name || oldDev.settlement_branch_id}" → "${newSb?.name || newDev.settlement_branch_id}"`);
  }
  if (oldDev.type !== newDev.type) {
    changes.push(`Тип: "${TYPE_LABELS[oldDev.type] || oldDev.type}" → "${TYPE_LABELS[newDev.type] || newDev.type}"`);
  }
  if (oldDev.status !== newDev.status) {
    changes.push(`Статус: "${STATUS_LABELS[oldDev.status] || oldDev.status}" → "${STATUS_LABELS[newDev.status] || newDev.status}"`);
  }

  const textFields = {
    name: 'Имя',
    inventory_number: 'Инв. номер',
    ip_address: 'IP',
    os: 'ОС',
    software: 'ПО',
    security: 'СЗИ',
    domain_joined: 'Домен',
    notes: 'Примечания'
  };

  for (const [key, label] of Object.entries(textFields)) {
    const oldVal = (oldDev[key] ?? '').trim();
    const newVal = (newDev[key] ?? '').trim();
    if (oldVal !== newVal) {
      changes.push(`${label}: "${oldVal || '—'}" → "${newVal || '—'}"`);
    }
  }

  return changes.length > 0 ? changes.join('; ') : 'Параметры устройства сохранены (без изменений)';
}

// 1. Список активных устройств (не в корзине)
router.get('/', (req, res) => {
  const { status, type, os, q } = req.query;
  let sql = `
    SELECT d.*,
           sb.name AS settlement_name, mb.name AS branch_name, mb.id AS municipal_branch_id
    FROM devices d
    JOIN settlement_branches sb ON sb.id = d.settlement_branch_id
    JOIN municipal_branches mb ON mb.id = sb.municipal_branch_id
    WHERE d.deleted_at IS NULL
  `;
  const params = [];
  if (status) { sql += ' AND d.status = ?'; params.push(status); }
  if (type) { sql += ' AND d.type = ?'; params.push(type); }
  if (os) { sql += ' AND d.os = ?'; params.push(os); }

  if (q) {
    sql += ' AND (d.name LIKE ? OR d.inventory_number LIKE ? OR d.ip_address LIKE ? OR sb.name LIKE ? OR mb.name LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like, like, like);
  }
  sql += ' ORDER BY mb.name, sb.name, d.type, d.name COLLATE NOCASE';
  res.json(db.prepare(sql).all(...params));
});

// 2. Список устройств в КОРЗИНЕ
router.get('/trash', (req, res) => {
  const rows = db.prepare(`
    SELECT d.*,
           sb.name AS settlement_name, mb.name AS branch_name, mb.id AS municipal_branch_id
    FROM devices d
    LEFT JOIN settlement_branches sb ON sb.id = d.settlement_branch_id
    LEFT JOIN municipal_branches mb ON mb.id = sb.municipal_branch_id
    WHERE d.deleted_at IS NOT NULL
    ORDER BY d.deleted_at DESC
  `).all();
  res.json(rows);
});

// 3. Очистить всю корзину навсегда
router.delete('/trash/empty', (req, res) => {
  const trashed = db.prepare('SELECT id, name, inventory_number FROM devices WHERE deleted_at IS NOT NULL').all();
  const emptyTx = db.transaction((items) => {
    const delStmt = db.prepare('DELETE FROM devices WHERE id = ?');
    for (const dev of items) {
      insertHistory.run(dev.id, 'DELETED', `Устройство "${dev.name}" (Инв. №: ${dev.inventory_number}) удалено навсегда при очистке корзины`);
      delStmt.run(dev.id);
    }
  });
  emptyTx(trashed);
  res.json({ success: true, deletedCount: trashed.length });
});

// 4. Список уникальных ОС (только среди активных устройств)
router.get('/os-list', (req, res) => {
  const rows = db.prepare(`
    SELECT DISTINCT trim(os) AS os
    FROM devices
    WHERE deleted_at IS NULL AND os IS NOT NULL AND trim(os) != ''
    ORDER BY os COLLATE NOCASE ASC
  `).all();
  res.json(rows.map(r => r.os));
});

// 5. Массовое перемещение
router.post('/move', (req, res) => {
  const { deviceIds, settlement_branch_id } = req.body;
  const targetId = Number(settlement_branch_id);

  if (!Array.isArray(deviceIds) || deviceIds.length === 0 || !targetId) {
    return res.status(400).json({ error: 'Укажите список устройств (deviceIds) и целевой населённый пункт (settlement_branch_id)' });
  }

  const targetSb = db.prepare('SELECT id, name FROM settlement_branches WHERE id = ?').get(targetId);
  if (!targetSb) {
    return res.status(404).json({ error: 'Целевой населённый пункт не найден' });
  }

  const moveTx = db.transaction((ids, sbId, sbName) => {
    const getOld = db.prepare('SELECT id, settlement_branch_id FROM devices WHERE id = ? AND deleted_at IS NULL');
    const updateStmt = db.prepare(`
      UPDATE devices 
      SET settlement_branch_id = ?, updated_at = datetime('now') 
      WHERE id = ?
    `);

    for (const id of ids) {
      const dev = getOld.get(id);
      if (!dev) {
        throw new Error(`Устройство с ID ${id} не найдено`);
      }
      if (dev.settlement_branch_id !== sbId) {
        updateStmt.run(sbId, id);
        insertHistory.run(id, 'UPDATED', `Перемещено в населённый пункт "${sbName}"`);
      }
    }
  });

  try {
    moveTx(deviceIds, targetId, targetSb.name);
    res.json({ success: true, movedCount: deviceIds.length });
  } catch (e) {
    if (e.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Конфликт: в целевом населённом пункте уже есть устройство с таким же инвентарным номером. Перемещение отменено.' });
    }
    res.status(400).json({ error: e.message });
  }
});

// 6. Восстановить устройство из корзины
router.post('/:id/restore', (req, res) => {
  const existing = db.prepare('SELECT * FROM devices WHERE id = ? AND deleted_at IS NOT NULL').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Устройство в корзине не найдено' });

  // Если за время нахождения в корзине у инвентарного номера был суффикс #trash_..., возвращаем чистый номер
  const cleanInv = existing.inventory_number.replace(/#trash_\d+$/, '');

  const conflict = db.prepare(`
    SELECT id FROM devices 
    WHERE settlement_branch_id = ? AND inventory_number = ? AND deleted_at IS NULL AND id != ?
  `).get(existing.settlement_branch_id, cleanInv, existing.id);

  if (conflict) {
    return res.status(409).json({
      error: `В этом населённом пункте уже есть активное устройство с инвентарным номером "${cleanInv}"`
    });
  }

  db.prepare(`
    UPDATE devices 
    SET deleted_at = NULL, inventory_number = ?, updated_at = datetime('now') 
    WHERE id = ?
  `).run(cleanInv, existing.id);

  insertHistory.run(existing.id, 'UPDATED', 'Устройство восстановлено из корзины');
  res.json({ success: true });
});

// 7. Окончательное удаление одного устройства из корзины
router.delete('/:id/permanent', (req, res) => {
  const existing = db.prepare('SELECT id, name, inventory_number FROM devices WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Устройство не найдено' });

  const cleanInv = existing.inventory_number.replace(/#trash_\d+$/, '');
  const deleteTx = db.transaction((dev) => {
    insertHistory.run(dev.id, 'DELETED', `Устройство "${dev.name}" (Инв. №: ${cleanInv}) удалено навсегда`);
    db.prepare('DELETE FROM devices WHERE id = ?').run(dev.id);
  });

  deleteTx(existing);
  res.status(204).end();
});

router.get('/:id', (req, res) => {
  const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(req.params.id);
  if (!device) return res.status(404).json({ error: 'Устройство не найдено' });
  res.json(device);
});

router.get('/:id/history', (req, res) => {
  const history = db.prepare(`
    SELECT * FROM device_history 
    WHERE device_id = ? 
    ORDER BY created_at DESC
  `).all(req.params.id);
  res.json(history);
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM devices WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Устройство не найдено' });

  let settlement_branch_id = Number(req.body.settlement_branch_id || existing.settlement_branch_id);
  const type = req.body.type || existing.type;
  const status = req.body.status || existing.status;

  if (!VALID_TYPES.includes(type)) {
    return res.status(400).json({ error: `Некорректный тип устройства: ${type}` });
  }
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Некорректный статус: ${status}` });
  }

  const inventory_number = String(req.body.inventory_number ?? existing.inventory_number ?? '').trim();
  const name = String(req.body.name ?? existing.name ?? '').trim();

  if (!name || !inventory_number) {
    return res.status(400).json({ error: 'Имя и инвентарный номер обязательны' });
  }

  const ip_address = String(req.body.ip_address ?? existing.ip_address ?? '').trim() || null;
  const os = String(req.body.os ?? existing.os ?? '').trim() || null;
  const software = String(req.body.software ?? existing.software ?? '').trim() || null;
  const security = String(req.body.security ?? existing.security ?? '').trim() || null;
  const domain_joined = String(req.body.domain_joined ?? existing.domain_joined ?? '').trim() || null;
  const notes = String(req.body.notes ?? existing.notes ?? '').trim() || null;

  const matchedSubnet = findSubnetConfigByIp(ip_address);
  if (matchedSubnet) {
    settlement_branch_id = ensureSettlementId(matchedSubnet.branch, matchedSubnet.settlement);
  }

  const updatedData = {
    settlement_branch_id,
    type,
    inventory_number,
    name,
    ip_address,
    os,
    software,
    security,
    domain_joined,
    notes,
    status
  };

  const diffDescription = buildDiffDescription(existing, updatedData);

  try {
    db.prepare(`
      UPDATE devices SET
        settlement_branch_id = ?,
        type = ?,
        inventory_number = ?,
        name = ?,
        ip_address = ?,
        os = ?,
        software = ?,
        security = ?,
        domain_joined = ?,
        notes = ?,
        status = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      settlement_branch_id,
      type,
      inventory_number,
      name,
      ip_address,
      os,
      software,
      security,
      domain_joined,
      notes,
      status,
      req.params.id
    );

    insertHistory.run(req.params.id, 'UPDATED', diffDescription);

    res.json(db.prepare('SELECT * FROM devices WHERE id = ?').get(req.params.id));
  } catch (e) {
    if (e.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Такой инвентарный номер уже есть в этом населённом пункте' });
    }
    res.status(500).json({ error: e.message });
  }
});

// 8. МЯГКОЕ УДАЛЕНИЕ (Перемещение в корзину вместо стирания)
router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT id, name, inventory_number FROM devices WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Устройство не найдено' });

  // Добавляем технический суффикс к инвентарнику в корзине, чтобы он не мешал UNIQUE constraint, пока лежит в корзине
  const trashedInv = `${existing.inventory_number}#trash_${Date.now()}`;

  const softDeleteTx = db.transaction((dev) => {
    db.prepare(`
      UPDATE devices 
      SET deleted_at = datetime('now'),
          is_online = 0,
          inventory_number = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(trashedInv, dev.id);

    insertHistory.run(dev.id, 'TRASHED', `Устройство "${dev.name}" (Инв. №: ${dev.inventory_number}) перемещено в корзину`);
  });

  softDeleteTx(existing);
  res.status(204).end();
});

router.patch('/:id/status', (req, res) => {
  const { status } = req.body;
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Некорректный статус' });
  }

  const oldDevice = db.prepare('SELECT status, name FROM devices WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!oldDevice) return res.status(404).json({ error: 'Устройство не найдено' });

  const info = db.prepare(`UPDATE devices SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, req.params.id);

  if (info.changes > 0 && oldDevice.status !== status) {
    const desc = `Статус изменён с "${STATUS_LABELS[oldDevice.status] || oldDevice.status}" на "${STATUS_LABELS[status] || status}"`;
    insertHistory.run(req.params.id, 'STATUS_CHANGE', desc);
  }

  res.json(db.prepare('SELECT * FROM devices WHERE id = ?').get(req.params.id));
});

module.exports = router;