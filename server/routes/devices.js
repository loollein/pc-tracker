const express = require('express');
const router = express.Router();
const db = require('../db');


const insertHistory = db.prepare(`
  INSERT INTO device_history (device_id, action, description)
  VALUES (?, ?, ?)
`);

router.get('/', (req, res) => {
  const { status, type, os, q } = req.query; // <-- Добавили 'os'
  let sql = `
    SELECT d.*, d.os, d.software, d.security, d.domain_joined, d.notes,
           sb.name AS settlement_name, mb.name AS branch_name, mb.id AS municipal_branch_id
    FROM devices d
    JOIN settlement_branches sb ON sb.id = d.settlement_branch_id
    JOIN municipal_branches mb ON mb.id = sb.municipal_branch_id
    WHERE 1=1
  `;
  const params = [];
  if (status) { sql += ' AND d.status = ?'; params.push(status); }
  if (type) { sql += ' AND d.type = ?'; params.push(type); }
  
  // ---> Вставьте этот блок фильтрации по ОС:
  if (os) { 
    sql += ' AND d.os = ?'; 
    params.push(os); 
  }
  // <---

  if (q) {
    sql += ' AND (d.name LIKE ? OR d.inventory_number LIKE ? OR d.ip_address LIKE ? OR sb.name LIKE ? OR mb.name LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like, like, like);
  }
  sql += ' ORDER BY mb.name, sb.name, d.type, d.name COLLATE NOCASE';
  res.json(db.prepare(sql).all(...params));
});

router.get('/:id', (req, res) => {
  const device = db.prepare('SELECT *, os, software, security, domain_joined, notes FROM devices WHERE id = ?').get(req.params.id);
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
  const existing = db.prepare('SELECT * FROM devices WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Устройство не найдено' });

  // Добавляем получение нового ID населенного пункта (если он передан, иначе оставляем старый)
  const settlement_branch_id = req.body.settlement_branch_id || existing.settlement_branch_id;
  const type = req.body.type || existing.type;
  const inventory_number = (req.body.inventory_number ?? existing.inventory_number).trim();
  const name = (req.body.name ?? existing.name).trim();
  const ip_address = (req.body.ip_address ?? existing.ip_address ?? '').trim() || null;
  const os = (req.body.os ?? existing.os ?? '').trim() || null;
  const software = (req.body.software ?? existing.software ?? '').trim() || null;
  const security = (req.body.security ?? existing.security ?? '').trim() || null;
  const domain_joined = (req.body.domain_joined ?? existing.domain_joined ?? '').trim() || null;
  const notes = (req.body.notes ?? existing.notes ?? '').trim() || null;
  const status = req.body.status || existing.status;

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

    // Записываем лог об обновлении
    insertHistory.run(req.params.id, 'UPDATED', 'Параметры устройства были обновлены');

    res.json(db.prepare('SELECT *, os, software, security, domain_joined, notes FROM devices WHERE id = ?').get(req.params.id));
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Такой инвентарный номер уже есть в этом населённом пункте' });
    res.status(500).json({ error: e.message });
  }
});

router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM devices WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Устройство не найдено' });
  res.status(204).end();
});

router.patch('/:id/status', (req, res) => {
  const { status } = req.body;
  if (!['working', 'repair', 'decommissioned'].includes(status)) {
    return res.status(400).json({ error: 'Некорректный статус' });
  }

  // Получаем старый статус для красивого описания
  const oldDevice = db.prepare('SELECT status, name FROM devices WHERE id = ?').get(req.params.id);
  if (!oldDevice) return res.status(404).json({ error: 'Устройство не найдено' });

  const info = db.prepare(`UPDATE devices SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, req.params.id);
  
  if (info.changes > 0 && oldDevice.status !== status) {
    const statusLabels = { working: 'Работает', repair: 'На ремонте', decommissioned: 'Списан' };
    const desc = `Статус изменён с "${statusLabels[oldDevice.status] || oldDevice.status}" на "${statusLabels[status] || status}"`;
    
    insertHistory.run(req.params.id, 'STATUS_CHANGE', desc);
  }

  res.json(db.prepare('SELECT * FROM devices WHERE id = ?').get(req.params.id));
});

// Получить историю изменений устройства
router.get('/:id/history', (req, res) => {
  const history = db.prepare(`
    SELECT * FROM device_history 
    WHERE device_id = ? 
    ORDER BY created_at DESC
  `).all(req.params.id);
  res.json(history);
});

module.exports = router;