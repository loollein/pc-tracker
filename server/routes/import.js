const express = require('express');
const router = express.Router();
const db = require('../db');

router.post('/', (req, res) => {
  const { rows } = req.body;
  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'Нет данных для импорта' });
  }

  const getBranch = db.prepare('SELECT id FROM municipal_branches WHERE name = ?');
  const insertBranch = db.prepare('INSERT INTO municipal_branches (name) VALUES (?)');
  const getSettlement = db.prepare('SELECT id FROM settlement_branches WHERE municipal_branch_id = ? AND name = ?');
  const insertSettlement = db.prepare('INSERT INTO settlement_branches (municipal_branch_id, name) VALUES (?, ?)');
  const getDevice = db.prepare('SELECT id FROM devices WHERE settlement_branch_id = ? AND inventory_number = ?');

  const insertDevice = db.prepare(`
    INSERT INTO devices (
      settlement_branch_id, type, inventory_number, name, ip_address,
      os, software, security, domain_joined, notes, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const updateDevice = db.prepare(`
    UPDATE devices SET
      type = ?, name = ?, ip_address = ?, os = ?, software = ?,
      security = ?, domain_joined = ?, notes = ?, status = ?,
      updated_at = datetime('now')
    WHERE settlement_branch_id = ? AND inventory_number = ?
  `);

  const processImport = db.transaction((importRows) => {
    let insertedDevices = 0, updatedDevices = 0, newBranches = 0, newSettlements = 0;
    const errors = [];

    importRows.forEach((row, index) => {
      const rowNumber = index + 2; // +2 учитывает шапку таблицы Excel и 0-индексацию

      const branchName = String(row['Муниципальный филиал'] || '').trim();
      const settlementName = String(row['Населённый пункт'] || '').trim();
      const rawType = String(row['Тип'] || '').trim().toLowerCase();
      const invNumber = String(row['Инвентарный номер'] || '').trim();
      const name = String(row['Название'] || '').trim();
      const ip = String(row['IP-адрес'] || '').trim() || null;
      const os = String(row['ОС'] || '').trim() || null;
      const software = String(row['Софт'] || '').trim() || null;
      const security = String(row['СЗИ'] || '').trim() || null;
      const domain_joined = String(row['Ввод в домен'] || '').trim() || null;
      const notes = String(row['Примечание'] || '').trim() || null;
      const rawStatus = String(row['Статус'] || '').trim().toLowerCase();

      // Проверка обязательных полей с фиксацией ошибки в отчете
      if (!branchName || !settlementName || !invNumber || !name) {
        errors.push({
          row: rowNumber,
          inventory: invNumber || '—',
          reason: 'Пропущены обязательные поля (Филиал, Населенный пункт, Инв. номер или Название)'
        });
        return;
      }

      const typeMap = {
        'пк': 'pc', 'pc': 'pc',
        'принтер': 'printer', 'printer': 'printer',
        'мфу': 'mfu', 'mfu': 'mfu',
        'сетевые устройства': 'network', 'сетевое устройство': 'network', 'network': 'network',
        'спм': 'spm', 'spm': 'spm',
        'другое': 'sempl', 'sempl': 'sempl'
      };
      const finalType = typeMap[rawType] || 'pc';

      const statusMap = {
        'работает': 'working', 'working': 'working',
        'на ремонте': 'repair', 'в ремонте': 'repair', 'repair': 'repair',
        'списан': 'decommissioned', 'списано': 'decommissioned', 'decommissioned': 'decommissioned'
      };
      const finalStatus = statusMap[rawStatus] || 'working';

      try {
        let branchId = getBranch.get(branchName)?.id;
        if (!branchId) {
          branchId = insertBranch.run(branchName).lastInsertRowid;
          newBranches++;
        }

        let settlementId = getSettlement.get(branchId, settlementName)?.id;
        if (!settlementId) {
          settlementId = insertSettlement.run(branchId, settlementName).lastInsertRowid;
          newSettlements++;
        }

        const existing = getDevice.get(settlementId, invNumber);
        if (existing) {
          updateDevice.run(finalType, name, ip, os, software, security, domain_joined, notes, finalStatus, settlementId, invNumber);
          updatedDevices++;
        } else {
          insertDevice.run(settlementId, finalType, invNumber, name, ip, os, software, security, domain_joined, notes, finalStatus);
          insertedDevices++;
        }
      } catch (err) {
        errors.push({
          row: rowNumber,
          inventory: invNumber,
          reason: err.message
        });
      }
    });

    return { 
      successCount: insertedDevices + updatedDevices, 
      insertedDevices, 
      updatedDevices, 
      newBranches, 
      newSettlements, 
      errorCount: errors.length, 
      errors 
    };
  });

  try {
    const stats = processImport(rows);
    res.json({ success: true, ...stats });
  } catch (e) {
    console.error('Ошибка импорта:', e);
    res.status(500).json({ error: 'Ошибка при импорте данных: ' + e.message });
  }
});

module.exports = router;