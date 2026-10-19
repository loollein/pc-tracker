const express = require('express');
const router = express.Router();
const db = require('../db');

// Список всех муниципальных филиалов со сводными счётчиками
router.get('/', (req, res) => {
  const branches = db.prepare(`
    SELECT
      mb.id, mb.name,
      COUNT(DISTINCT sb.id) AS settlements_count,
      COUNT(d.id) AS devices_count,
      SUM(CASE WHEN d.status = 'working' THEN 1 ELSE 0 END) AS working_count,
      SUM(CASE WHEN d.status = 'repair' THEN 1 ELSE 0 END) AS repair_count,
      SUM(CASE WHEN d.status = 'decommissioned' THEN 1 ELSE 0 END) AS decommissioned_count
    FROM municipal_branches mb
    LEFT JOIN settlement_branches sb ON sb.municipal_branch_id = mb.id
    LEFT JOIN devices d ON d.settlement_branch_id = sb.id
    GROUP BY mb.id
    ORDER BY mb.name COLLATE NOCASE
  `).all();
  res.json(branches);
});

// Создать муниципальный филиал
router.post('/', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Укажите название филиала' });
  try {
    const info = db.prepare('INSERT INTO municipal_branches (name) VALUES (?)').run(name.trim());
    res.status(201).json({ id: info.lastInsertRowid, name: name.trim() });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Такой филиал уже существует' });
    res.status(500).json({ error: e.message });
  }
});

// Получить один филиал
router.get('/:id', (req, res) => {
  const branch = db.prepare('SELECT * FROM municipal_branches WHERE id = ?').get(req.params.id);
  if (!branch) return res.status(404).json({ error: 'Филиал не найден' });
  res.json(branch);
});

// Переименовать филиал
router.put('/:id', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Укажите название филиала' });
  const info = db.prepare('UPDATE municipal_branches SET name = ? WHERE id = ?').run(name.trim(), req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Филиал не найден' });
  res.json({ id: Number(req.params.id), name: name.trim() });
});

// Удалить филиал (каскадно удалит вложенные населённые пункты и устройства)
router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM municipal_branches WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Филиал не найден' });
  res.status(204).end();
});

// Список населённых пунктов внутри филиала
router.get('/:id/settlements', (req, res) => {
  const settlements = db.prepare(`
    SELECT
      sb.id, sb.name, sb.municipal_branch_id,
      COUNT(d.id) AS devices_count,
      SUM(CASE WHEN d.status = 'working' THEN 1 ELSE 0 END) AS working_count,
      SUM(CASE WHEN d.status = 'repair' THEN 1 ELSE 0 END) AS repair_count,
      SUM(CASE WHEN d.status = 'decommissioned' THEN 1 ELSE 0 END) AS decommissioned_count
    FROM settlement_branches sb
    LEFT JOIN devices d ON d.settlement_branch_id = sb.id
    WHERE sb.municipal_branch_id = ?
    GROUP BY sb.id
    ORDER BY sb.name COLLATE NOCASE
  `).all(req.params.id);
  res.json(settlements);
});

// Создать населённый пункт внутри филиала
router.post('/:id/settlements', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Укажите название населённого пункта' });
  const branch = db.prepare('SELECT id FROM municipal_branches WHERE id = ?').get(req.params.id);
  if (!branch) return res.status(404).json({ error: 'Филиал не найден' });
  try {
    const info = db.prepare('INSERT INTO settlement_branches (municipal_branch_id, name) VALUES (?, ?)')
      .run(req.params.id, name.trim());
    res.status(201).json({ id: info.lastInsertRowid, name: name.trim(), municipal_branch_id: Number(req.params.id) });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Такой населённый пункт уже есть в этом филиале' });
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
