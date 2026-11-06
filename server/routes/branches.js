// server/routes/branches.js
const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', (req, res) => {
  const branches = db.prepare(`
    SELECT
      mb.id,
      mb.name,
      mb.notes,
      mb.created_at,
      COUNT(DISTINCT sb.id) AS settlements_count,
      COUNT(d.id) AS devices_count,
      SUM(CASE WHEN d.status = 'working' THEN 1 ELSE 0 END) AS working_count,
      SUM(CASE WHEN d.status = 'repair' THEN 1 ELSE 0 END) AS repair_count,
      SUM(CASE WHEN d.status = 'decommissioned' THEN 1 ELSE 0 END) AS decommissioned_count
    FROM municipal_branches mb
    LEFT JOIN settlement_branches sb ON sb.municipal_branch_id = mb.id
    LEFT JOIN devices d ON d.settlement_branch_id = sb.id AND d.deleted_at IS NULL
    GROUP BY mb.id
    ORDER BY mb.name COLLATE NOCASE
  `).all();
  res.json(branches);
});

router.post('/', (req, res) => {
  const { name, notes } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Укажите название филиала' });
  const finalNotes = (notes || '').trim() || null;

  try {
    const info = db.prepare('INSERT INTO municipal_branches (name, notes) VALUES (?, ?)').run(name.trim(), finalNotes);
    res.status(201).json({ id: info.lastInsertRowid, name: name.trim(), notes: finalNotes });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Филиал с таким названием уже существует' });
    res.status(500).json({ error: e.message });
  }
});

router.get('/:id', (req, res) => {
  const branch = db.prepare('SELECT * FROM municipal_branches WHERE id = ?').get(req.params.id);
  if (!branch) return res.status(404).json({ error: 'Филиал не найден' });
  res.json(branch);
});

router.put('/:id', (req, res) => {
  const { name, notes } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Укажите название филиала' });

  const existing = db.prepare('SELECT * FROM municipal_branches WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Филиал не найден' });

  const finalNotes = notes !== undefined ? ((notes || '').trim() || null) : existing.notes;

  try {
    db.prepare('UPDATE municipal_branches SET name = ?, notes = ? WHERE id = ?').run(name.trim(), finalNotes, req.params.id);
    res.json({ id: Number(req.params.id), name: name.trim(), notes: finalNotes });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Филиал с таким названием уже существует' });
    res.status(500).json({ error: e.message });
  }
});

router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM municipal_branches WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Филиал не найден' });
  res.status(204).end();
});

router.get('/:id/settlements', (req, res) => {
  const settlements = db.prepare(`
    SELECT
      sb.id,
      sb.name,
      sb.notes,
      sb.municipal_branch_id,
      COUNT(d.id) AS devices_count,
      SUM(CASE WHEN d.status = 'working' THEN 1 ELSE 0 END) AS working_count,
      SUM(CASE WHEN d.status = 'repair' THEN 1 ELSE 0 END) AS repair_count,
      SUM(CASE WHEN d.status = 'decommissioned' THEN 1 ELSE 0 END) AS decommissioned_count
    FROM settlement_branches sb
    LEFT JOIN devices d ON d.settlement_branch_id = sb.id AND d.deleted_at IS NULL
    WHERE sb.municipal_branch_id = ?
    GROUP BY sb.id
    ORDER BY sb.name COLLATE NOCASE
  `).all(req.params.id);
  res.json(settlements);
});

router.post('/:id/settlements', (req, res) => {
  const { name, notes } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Укажите название населённого пункта' });
  const finalNotes = (notes || '').trim() || null;

  const branch = db.prepare('SELECT id FROM municipal_branches WHERE id = ?').get(req.params.id);
  if (!branch) return res.status(404).json({ error: 'Филиал не найден' });

  try {
    const info = db.prepare('INSERT INTO settlement_branches (municipal_branch_id, name, notes) VALUES (?, ?, ?)').run(req.params.id, name.trim(), finalNotes);
    res.status(201).json({
      id: info.lastInsertRowid,
      municipal_branch_id: Number(req.params.id),
      name: name.trim(),
      notes: finalNotes
    });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Такой населённый пункт уже есть в этом филиале' });
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;