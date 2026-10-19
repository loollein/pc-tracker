const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', (req, res) => {
  const settlements = db.prepare(`
    SELECT
      sb.id, sb.name, sb.municipal_branch_id,
      mb.name AS municipal_branch_name,
      COUNT(d.id) AS devices_count,
      SUM(CASE WHEN d.status = 'working' THEN 1 ELSE 0 END) AS working_count,
      SUM(CASE WHEN d.status = 'repair' THEN 1 ELSE 0 END) AS repair_count,
      SUM(CASE WHEN d.status = 'decommissioned' THEN 1 ELSE 0 END) AS decommissioned_count
    FROM settlement_branches sb
    JOIN municipal_branches mb ON mb.id = sb.municipal_branch_id
    LEFT JOIN devices d ON d.settlement_branch_id = sb.id
    GROUP BY sb.id
    ORDER BY mb.name, sb.name
  `).all();
  res.json(settlements);
});

router.get('/:id', (req, res) => {
  const settlement = db.prepare('SELECT * FROM settlement_branches WHERE id = ?').get(req.params.id);
  if (!settlement) return res.status(404).json({ error: 'Населённый пункт не найден' });
  res.json(settlement);
});

router.put('/:id', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Укажите название' });
  const info = db.prepare('UPDATE settlement_branches SET name = ? WHERE id = ?').run(name.trim(), req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Не найден' });
  res.json({ id: Number(req.params.id), name: name.trim() });
});

router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM settlement_branches WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Не найден' });
  res.status(204).end();
});

router.get('/:id/devices', (req, res) => {
  const { type, status } = req.query;
  let sql = 'SELECT * FROM devices WHERE settlement_branch_id = ?';
  const params = [req.params.id];
  if (type) { sql += ' AND type = ?'; params.push(type); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY type, name COLLATE NOCASE';
  res.json(db.prepare(sql).all(...params));
});

router.post('/:id/devices', (req, res) => {
  const { type, inventory_number, name, ip_address, status, os, software, security, domain_joined, notes } = req.body;
  if (!type || !['pc', 'printer', 'mfu', 'network', 'spm', 'sempl'].includes(type)) return res.status(400).json({ error: 'Некорректный тип устройства' });
  if (!inventory_number || !inventory_number.trim()) return res.status(400).json({ error: 'Укажите инвентарный номер' });
  if (!name || !name.trim()) return res.status(400).json({ error: 'Укажите название устройства' });

  const finalStatus = status && ['working', 'repair', 'decommissioned'].includes(status) ? status : 'working';
  const finalOs = (os || '').trim() || null;
  const finalSoftware = (software || '').trim() || null;
  const finalSecurity = (security || '').trim() || null;
  const finalDomainJoined = (domain_joined || '').trim() || null;
  const finalNotes = (notes || '').trim() || null;
  const finalIp = (ip_address || '').trim() || null;

  const settlement = db.prepare('SELECT id FROM settlement_branches WHERE id = ?').get(req.params.id);
  if (!settlement) return res.status(404).json({ error: 'Населённый пункт не найден' });

  try {
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
      req.params.id,
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
    const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(device);
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Такой инвентарный номер уже есть в этом населённом пункте' });
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;