// Необязательный скрипт с демо-данными. Запуск: npm run seed
// Полезно, чтобы сразу увидеть, как выглядит структура и дашборд.
const db = require('./db');

const insertBranch = db.prepare('INSERT OR IGNORE INTO municipal_branches (name) VALUES (?)');
const insertSettlement = db.prepare('INSERT OR IGNORE INTO settlement_branches (municipal_branch_id, name) VALUES (?, ?)');
const insertDevice = db.prepare(`
  INSERT OR IGNORE INTO devices (settlement_branch_id, type, inventory_number, name, ip_address, status)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const data = {
  'Центральный муниципальный филиал': {
    'г. Заречное': [
      { type: 'pc', inv: 'INV-0001', name: 'ПК бухгалтерии', ip: '192.168.10.11', status: 'working' },
      { type: 'pc', inv: 'INV-0002', name: 'ПК администратора', ip: '192.168.10.12', status: 'repair' },
      { type: 'printer', inv: 'INV-0003', name: 'Принтер Kyocera', ip: '192.168.10.20', status: 'working' },
    ],
    'п. Сосновка': [
      { type: 'pc', inv: 'INV-0004', name: 'ПК специалиста', ip: '192.168.11.11', status: 'working' },
      { type: 'printer', inv: 'INV-0005', name: 'Принтер HP LaserJet', ip: '192.168.11.20', status: 'decommissioned' },
    ],
  },
  'Южный муниципальный филиал': {
    'с. Родниково': [
      { type: 'pc', inv: 'INV-0006', name: 'ПК регистратуры', ip: '192.168.20.11', status: 'working' },
      { type: 'pc', inv: 'INV-0007', name: 'ПК главврача', ip: '192.168.20.12', status: 'repair' },
    ],
  },
};

for (const [branchName, settlements] of Object.entries(data)) {
  const branchInfo = insertBranch.run(branchName);
  const branchId = branchInfo.lastInsertRowid ||
    db.prepare('SELECT id FROM municipal_branches WHERE name = ?').get(branchName).id;

  for (const [settlementName, devices] of Object.entries(settlements)) {
    const settlementInfo = insertSettlement.run(branchId, settlementName);
    const settlementId = settlementInfo.lastInsertRowid ||
      db.prepare('SELECT id FROM settlement_branches WHERE municipal_branch_id = ? AND name = ?').get(branchId, settlementName).id;

    for (const dev of devices) {
      insertDevice.run(settlementId, dev.type, dev.inv, dev.name, dev.ip, dev.status);
    }
  }
}

console.log('Демо-данные добавлены.');
