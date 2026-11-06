// server/routes/import.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { findSubnetConfigByIp, ensureSettlementId } = require('../scanner');

function parseDeviceType(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s || s === 'пк' || s === 'pc' || s.includes('компьютер') || s.includes('системный блок') || s.includes('ноутбук') || s.includes('моноблок')) {
    return 'pc';
  }
  if (s.includes('принтер') || s === 'printer') return 'printer';
  if (s.includes('мфу') || s === 'mfu') return 'mfu';
  if (s.includes('сет') || s === 'network' || s.includes('коммутатор') || s.includes('роутер') || s.includes('маршрутизатор')) return 'network';
  if (s.includes('спм') || s === 'spm') return 'spm';
  return 'sempl';
}

function parseDeviceStatus(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (s.includes('ремонт') || s === 'repair') return 'repair';
  if (s.includes('списан') || s === 'decommissioned') return 'decommissioned';
  return 'working';
}

function getField(row, possibleKeys) {
  for (const key of Object.keys(row)) {
    const cleanKey = key.trim().toLowerCase();
    if (possibleKeys.includes(cleanKey)) {
      return String(row[key] ?? '').trim();
    }
  }
  return '';
}

router.post('/', (req, res) => {
  const { rows } = req.body;
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'Нет данных для импорта' });
  }

  let insertedDevices = 0;
  let updatedDevices = 0;
  let newBranches = 0;
  let newSettlements = 0;
  const errors = [];

  const insertHistory = db.prepare(`
    INSERT INTO device_history (device_id, action, description)
    VALUES (?, ?, ?)
  `);

  const importTx = db.transaction((items) => {
    items.forEach((row, index) => {
      const rowNum = index + 2; // Учитываем строку заголовка в Excel

      let branchName = getField(row, ['муниципальный филиал', 'филиал', 'branch']);
      let settlementName = getField(row, ['населённый пункт', 'населенный пункт', 'пункт', 'settlement']);
      const rawType = getField(row, ['тип', 'тип устройства', 'тип техники', 'type']);
      const inventoryNumber = getField(row, ['инвентарный номер', 'инв. номер', 'инв номер', 'инвентарник', 'inventory_number']);
      const name = getField(row, ['название', 'имя', 'наименование', 'name']);
      const ipAddress = getField(row, ['ip-адрес', 'ip адрес', 'ip', 'ip_address']) || null;
      const os = getField(row, ['ос', 'операционная система', 'os']) || null;
      const software = getField(row, ['софт', 'по', 'установленное по', 'software']) || null;
      const security = getField(row, ['сзи', 'средства защиты', 'security']) || null;
      const domainJoined = getField(row, ['ввод в домен', 'домен', 'domain', 'domain_joined']) || null;
      const notes = getField(row, ['примечание', 'примечания', 'заметки', 'комментарий', 'notes']) || null;
      const rawStatus = getField(row, ['статус', 'состояние', 'status']);

      if (!inventoryNumber) {
        errors.push({ row: rowNum, inventory: '—', reason: 'Не указан инвентарный номер' });
        return;
      }
      if (!name) {
        errors.push({ row: rowNum, inventory: inventoryNumber, reason: 'Не указано название устройства' });
        return;
      }

      // Если IP попадает в известную подсеть из subnets.js — привязываем к филиалу/пункту подсети
      const matchedSubnet = findSubnetConfigByIp(ipAddress);
      if (matchedSubnet) {
        branchName = matchedSubnet.branch;
        settlementName = matchedSubnet.settlement;
      }

      if (!branchName || !settlementName) {
        errors.push({
          row: rowNum,
          inventory: inventoryNumber,
          reason: 'Не указан филиал или населённый пункт (и не удалось определить по IP)'
        });
        return;
      }

      const type = parseDeviceType(rawType);
      const status = parseDeviceStatus(rawStatus);

      try {
        let branch = db.prepare('SELECT id FROM municipal_branches WHERE name = ?').get(branchName);
        if (!branch) {
          const bInfo = db.prepare('INSERT INTO municipal_branches (name) VALUES (?)').run(branchName);
          branch = { id: bInfo.lastInsertRowid };
          newBranches++;
        }

        let settlement = db.prepare('SELECT id FROM settlement_branches WHERE municipal_branch_id = ? AND name = ?')
          .get(branch.id, settlementName);
        if (!settlement) {
          const sInfo = db.prepare('INSERT INTO settlement_branches (municipal_branch_id, name) VALUES (?, ?)')
            .run(branch.id, settlementName);
          settlement = { id: sInfo.lastInsertRowid };
          newSettlements++;
        }

        // Ищем только среди АКТИВНЫХ устройств (не в корзине!)
        const existing = db.prepare(`
          SELECT id FROM devices 
          WHERE settlement_branch_id = ? AND inventory_number = ? AND deleted_at IS NULL
        `).get(settlement.id, inventoryNumber);

        if (existing) {
          db.prepare(`
            UPDATE devices SET
              type = ?,
              name = ?,
              ip_address = COALESCE(?, ip_address),
              os = COALESCE(?, os),
              software = COALESCE(?, software),
              security = COALESCE(?, security),
              domain_joined = COALESCE(?, domain_joined),
              notes = COALESCE(?, notes),
              status = ?,
              updated_at = datetime('now')
            WHERE id = ?
          `).run(type, name, ipAddress, os, software, security, domainJoined, notes, status, existing.id);

          insertHistory.run(existing.id, 'UPDATED', `Обновлено при импорте из Excel ("${settlementName}")`);
          updatedDevices++;
        } else {
          const info = db.prepare(`
            INSERT INTO devices (
              settlement_branch_id, type, inventory_number, name, ip_address,
              os, software, security, domain_joined, notes, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(settlement.id, type, inventoryNumber, name, ipAddress, os, software, security, domainJoined, notes, status);

          insertHistory.run(info.lastInsertRowid, 'CREATED', `Импортировано из Excel в "${settlementName}"`);
          insertedDevices++;
        }
      } catch (err) {
        errors.push({ row: rowNum, inventory: inventoryNumber, reason: err.message });
      }
    });
  });

  try {
    importTx(rows);
    res.json({
      insertedDevices,
      updatedDevices,
      newBranches,
      newSettlements,
      errorCount: errors.length,
      errors
    });
  } catch (e) {
    res.status(500).json({ error: 'Критическая ошибка импорта: ' + e.message });
  }
});

module.exports = router;