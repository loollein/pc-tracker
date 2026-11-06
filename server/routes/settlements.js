// server/routes/settlements.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { findSubnetConfigByIp, ensureSettlementId } = require('../scanner');

const VALID_TYPES = ['pc', 'printer', 'mfu', 'network', 'spm', 'sempl'];
const VALID_STATUSES = ['working', 'repair', 'decommissioned'];

const insertHistory = db.prepare(`
  INSERT INTO device_history (device_id, action, description)
  VALUES (?, ?, ?)
`);

router.get('/', (req, res) => {
  const settlements = db.prepare(`
    SELECT
      sb.id, sb.name, sb.notes, sb.municipal_branch_id,
      mb.name AS municipal_branch_name,
      COUNT(d.id) AS devices_count,
      SUM(CASE WHEN d.status = 'working' THEN 1 ELSE 0 END) AS working_count,
      SUM(CASE WHEN d.status = 'repair' THEN 1 ELSE 0 END) AS repair_count,
      SUM(CASE WHEN d.status = 'decommissioned' THEN 1 ELSE 0 END) AS decommissioned_count
    FROM settlement_branches sb
    JOIN municipal_branches mb ON mb.id = sb.municipal_branch_id
    LEFT JOIN devices d ON d.settlement_branch_id = sb.id AND d.deleted_at IS NULL
    GROUP BY sb.id
    ORDER BY mb.name, sb.name
  `).all();
  res.json(settlements);
});

// Массовое переподчинение населённых пунктов другому муниципальному филиалу
router.post('/move', (req, res) => {
  const { settlementIds, targetBranchId } = req.body;
  const branchId = Number(targetBranchId);

  if (!Array.isArray(settlementIds) || settlementIds.length === 0 || !branchId) {
    return res.status(400).json({ error: 'Укажите список пунктов (settlementIds) и целевой филиал (targetBranchId)' });
  }

  const branch = db.prepare('SELECT id, name FROM municipal_branches WHERE id = ?').get(branchId);
  if (!branch) return res.status(404).json({ error: 'Целевой филиал не найден' });

  const moveTx = db.transaction((ids, bId) => {
    const upd = db.prepare('UPDATE settlement_branches SET municipal_branch_id = ? WHERE id = ?');
    for (const id of ids) {
      upd.run(bId, Number(id));
    }
  });

  try {
    moveTx(settlementIds, branchId);
    res.json({ success: true, movedCount: settlementIds.length });
  } catch (e) {
    if (e.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Конфликт: в целевом филиале уже есть населённый пункт с таким же названием' });
    }
    res.status(400).json({ error: e.message });
  }
});

router.get('/:id', (req, res) => {
  const settlement = db.prepare('SELECT * FROM settlement_branches WHERE id = ?').get(req.params.id);
  if (!settlement) return res.status(404).json({ error: 'Населённый пункт не найден' });
  res.json(settlement);
});

router.put('/:id', (req, res) => {
  const { name, notes, municipal_branch_id } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Укажите название' });

  const existing = db.prepare('SELECT * FROM settlement_branches WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Не найден' });

  const finalNotes = notes !== undefined ? ((notes || '').trim() || null) : existing.notes;
  const finalBranchId = municipal_branch_id ? Number(municipal_branch_id) : existing.municipal_branch_id;

  try {
    db.prepare('UPDATE settlement_branches SET name = ?, notes = ?, municipal_branch_id = ? WHERE id = ?')
      .run(name.trim(), finalNotes, finalBranchId, req.params.id);
    res.json({
      id: Number(req.params.id),
      name: name.trim(),
      notes: finalNotes,
      municipal_branch_id: finalBranchId
    });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Такой населённый пункт уже есть в этом филиале' });
    res.status(500).json({ error: e.message });
  }
});

router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM settlement_branches WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Не найден' });
  res.status(204).end();
});

router.get('/:id/devices', (req, res) => {
  const { type, status } = req.query;
  let sql = 'SELECT * FROM devices WHERE settlement_branch_id = ? AND deleted_at IS NULL';
  const params = [req.params.id];
  if (type) { sql += ' AND type = ?'; params.push(type); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY type, name COLLATE NOCASE';
  res.json(db.prepare(sql).all(...params));
});

router.post('/:id/devices', (req, res) => {
  const { type, inventory_number, name, ip_address, status, os, software, security, domain_joined, notes } = req.body;
  if (!type || !VALID_TYPES.includes(type)) {
    return res.status(400).json({ error: 'Некорректный тип устройства' });
  }
  if (!inventory_number || !inventory_number.trim()) {
    return res.status(400).json({ error: 'Укажите инвентарный номер' });
  }
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Укажите название устройства' });
  }

  const finalStatus = status && VALID_STATUSES.includes(status) ? status : 'working';
  const finalOs = (os || '').trim() || null;
  const finalSoftware = (software || '').trim() || null;
  const finalSecurity = (security || '').trim() || null;
  const finalDomainJoined = (domain_joined || '').trim() || null;
  const finalNotes = (notes || '').trim() || null;
  const finalIp = (ip_address || '').trim() || null;

  let targetSettlementId = Number(req.params.id);
  const matchedSubnet = findSubnetConfigByIp(finalIp);
  if (matchedSubnet) {
    targetSettlementId = ensureSettlementId(matchedSubnet.branch, matchedSubnet.settlement);
  }

  const settlement = db.prepare('SELECT id, name FROM settlement_branches WHERE id = ?').get(targetSettlementId);
  if (!settlement) return res.status(404).json({ error: 'Населённый пункт не найден' });

  try {
    const createTx = db.transaction(() => {
      const info = db.prepare(`
        INSERT INTO devices (
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        targetSettlementId,
        type,
        inventory_number.trim(),
        name.trim(),
        finalIp,
        finalOs,
        finalSoftware,
        finalSecurity,
        finalDomainJoined,
        finalNotes,
        finalStatus
      );

      insertHistory.run(
        info.lastInsertRowid,
        'CREATED',
        `Устройство "${name.trim()}" (Инв. №: ${inventory_number.trim()}) добавлено в "${settlement.name}"`
      );

      return db.prepare('SELECT * FROM devices WHERE id = ?').get(info.lastInsertRowid);
    });

    const device = createTx();
    res.status(201).json(device);
  } catch (e) {
    if (e.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Такой инвентарный номер уже есть в этом населённом пункте' });
    }
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;