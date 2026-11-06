// server/scanner.js
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const dns = require('dns').promises;
const dgram = require('dgram');
const net = require('net');
const os = require('os');
const db = require('./db');
const SUBNETS = require('./subnets');

let isScanning = false;

function ipToInt(ip) {
  if (!ip || typeof ip !== 'string') return null;
  const parts = ip.trim().split('.');
  if (parts.length !== 4) return null;
  let num = 0;
  for (const part of parts) {
    const n = Number(part);
    if (Number.isNaN(n) || n < 0 || n > 255) return null;
    num = (num << 8) + n;
  }
  return num >>> 0;
}

function intToIp(int) {
  return [
    (int >>> 24) & 255,
    (int >>> 16) & 255,
    (int >>> 8) & 255,
    int & 255
  ].join('.');
}

function getIpsFromConfig(netConfig) {
  const skipSet = new Set(netConfig.skipIps || []);
  const ips = [];

  if (netConfig.startIp && netConfig.endIp) {
    const start = ipToInt(netConfig.startIp);
    const end = ipToInt(netConfig.endIp);
    if (start !== null && end !== null && end >= start && (end - start) <= 1024) {
      for (let cur = start; cur <= end; cur++) {
        const ip = intToIp(cur);
        if (!skipSet.has(ip)) ips.push(ip);
      }
    }
    return ips;
  }

  if (netConfig.subnet && typeof netConfig.subnet === 'string') {
    const cleanIp = netConfig.subnet.split('/')[0];
    const octets = cleanIp.split('.');
    if (octets.length === 4) {
      const basePrefix = `${octets[0]}.${octets[1]}.${octets[2]}`;
      for (let i = 1; i <= 254; i++) {
        const ip = `${basePrefix}.${i}`;
        if (!skipSet.has(ip)) ips.push(ip);
      }
    }
  }

  return ips;
}

function findSubnetConfigByIp(ip) {
  const targetInt = ipToInt(ip);
  if (targetInt === null) return null;

  return SUBNETS.find((s) => {
    if (s.startIp && s.endIp) {
      const start = ipToInt(s.startIp);
      const end = ipToInt(s.endIp);
      return start !== null && end !== null && targetInt >= start && targetInt <= end;
    }
    if (s.subnet && typeof s.subnet === 'string') {
      const cleanIp = s.subnet.split('/')[0];
      const octets = cleanIp.split('.');
      if (octets.length === 4) {
        const prefix = `${octets[0]}.${octets[1]}.${octets[2]}.`;
        return String(ip).trim().startsWith(prefix);
      }
    }
    return false;
  }) || null;
}

function ensureSettlementId(branchName, settlementName) {
  let branch = db.prepare('SELECT id FROM municipal_branches WHERE name = ?').get(branchName);
  if (!branch) {
    const info = db.prepare('INSERT INTO municipal_branches (name) VALUES (?)').run(branchName);
    branch = { id: info.lastInsertRowid };
  }

  let settlement = db.prepare('SELECT id FROM settlement_branches WHERE municipal_branch_id = ? AND name = ?').get(branch.id, settlementName);
  if (!settlement) {
    const info = db.prepare('INSERT INTO settlement_branches (municipal_branch_id, name) VALUES (?, ?)').run(branch.id, settlementName);
    settlement = { id: info.lastInsertRowid };
  }

  return settlement.id;
}

function pingHost(ip) {
  return new Promise((resolve) => {
    const isWin = os.platform() === 'win32';
    const args = isWin ? ['-n', '1', '-w', '1000', ip] : ['-c', '1', '-W', '1', ip];
    execFile('ping', args, (err) => {
      resolve(!err);
    });
  });
}

function checkPort(ip, port, timeout = 400) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let status = false;
    socket.setTimeout(timeout);
    socket.on('connect', () => { status = true; socket.destroy(); });
    socket.on('timeout', () => { socket.destroy(); });
    socket.on('error', () => { socket.destroy(); });
    socket.on('close', () => { resolve(status); });
    socket.connect(port, ip);
  });
}

function resolveNetbiosName(ip, timeout = 350) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    let settled = false;

    const finish = (val) => {
      if (settled) return;
      settled = true;
      try { socket.close(); } catch {}
      resolve(val);
    };

    const packet = Buffer.from([
      0x80, 0x94, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x20, 0x43, 0x4b, 0x41,
      0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41,
      0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41,
      0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41,
      0x41, 0x41, 0x41, 0x41, 0x41, 0x00, 0x00, 0x21,
      0x00, 0x01
    ]);

    const timer = setTimeout(() => finish(null), timeout);

    socket.on('error', () => {
      clearTimeout(timer);
      finish(null);
    });

    socket.on('message', (msg) => {
      clearTimeout(timer);
      if (msg.length > 57) {
        const numNames = msg[56];
        let offset = 57;
        for (let i = 0; i < numNames && offset + 18 <= msg.length; i++) {
          const rawName = msg.subarray(offset, offset + 15).toString('ascii').trim();
          const nameType = msg[offset + 15];
          const flags = msg[offset + 16];
          const isGroup = (flags & 0x80) !== 0;
          if (!isGroup && (nameType === 0x00 || nameType === 0x20) && rawName && !rawName.startsWith('\u0000')) {
            return finish(rawName);
          }
          offset += 18;
        }
      }
      finish(null);
    });

    socket.send(packet, 137, ip, (err) => {
      if (err) {
        clearTimeout(timer);
        finish(null);
      }
    });
  });
}

async function resolveHostname(ip) {
  try {
    const hostnames = await dns.reverse(ip);
    if (hostnames && hostnames.length > 0) {
      const shortName = hostnames[0].split('.')[0].trim();
      if (shortName) return shortName;
    }
  } catch {}
  return await resolveNetbiosName(ip);
}

function extractWorkstationKey(str) {
  if (!str) return null;
  const s = String(str).toLowerCase();
  const match = s.match(/(?:^|[^a-zа-яё0-9])(ws|arm|pc|пк|арм|комп)[-_\s]*0*([0-9]+)(?=$|[^0-9])/i);
  if (match) {
    let prefix = match[1].toLowerCase();
    if (prefix === 'пк' || prefix === 'комп') prefix = 'pc';
    if (prefix === 'арм') prefix = 'arm';
    return `${prefix}:${parseInt(match[2], 10)}`;
  }
  return null;
}

function normalizeHostString(str) {
  if (!str) return '';
  return String(str)
    .toLowerCase()
    .split('.')[0]
    .replace(/^(пк|pc|устр\.|устройство)\s+/i, '')
    .replace(/[-_\s]+/g, '')
    .replace(/([a-zа-яё]+)0+([1-9][0-9]*)$/i, '$1$2')
    .trim();
}

function findDeviceByHostname(hostname, targetSettlementId) {
  if (!hostname) return null;

  const hostNorm = normalizeHostString(hostname);
  const hostWsKey = extractWorkstationKey(hostname);

  const candidates = db.prepare(`
    SELECT * FROM devices
    WHERE deleted_at IS NULL
    ORDER BY CASE WHEN settlement_branch_id = ? THEN 0 ELSE 1 END, id ASC
  `).all(targetSettlementId);

  for (const dev of candidates) {
    const devNorm = normalizeHostString(dev.name);
    if (devNorm && devNorm === hostNorm) {
      return dev;
    }
  }

  if (hostWsKey) {
    for (const dev of candidates) {
      const devWsKey = extractWorkstationKey(dev.name) || extractWorkstationKey(dev.notes);
      if (devWsKey && devWsKey === hostWsKey) {
        return dev;
      }
    }
  }

  return null;
}

async function getArpTable() {
  try {
    const isWin = os.platform() === 'win32';
    const cmd = isWin ? 'arp' : 'ip';
    const args = isWin ? ['-a'] : ['neigh', 'show'];
    const { stdout } = await execFileAsync(cmd, args);

    const arpMap = new Map();
    const lines = stdout.split('\n');

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (isWin && parts.length >= 2) {
        const ip = parts[0];
        const mac = parts[1].replace(/-/g, ':').toLowerCase();
        if (/^\d+\.\d+\.\d+\.\d+$/.test(ip) && /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(mac)) {
          arpMap.set(ip, mac);
        }
      } else if (!isWin && parts.length >= 4) {
        const ip = parts[0];
        const macIndex = parts.indexOf('lladdr');
        if (macIndex !== -1 && parts[macIndex + 1]) {
          arpMap.set(ip, parts[macIndex + 1].toLowerCase());
        }
      }
    }
    return arpMap;
  } catch {
    return new Map();
  }
}

async function detectDeviceTypeAndVendor(ip, mac) {
  let type = 'pc';
  let notesAdd = '';

  const [isPrinter9100, isPrinter631, isRdpOpen, isSshOpen] = await Promise.all([
    checkPort(ip, 9100),
    checkPort(ip, 631),
    checkPort(ip, 3389),
    checkPort(ip, 22)
  ]);

  if (isPrinter9100 || isPrinter631) {
    type = 'printer';
    notesAdd = ' (Принтер: открыт порт 9100/631)';
  } else if (isSshOpen && !isRdpOpen) {
    type = 'network';
    notesAdd = ' (SSH / Linux или сетевое оборудование)';
  } else if (isRdpOpen) {
    type = 'pc';
    notesAdd = ' (Windows ПК: открыт RDP)';
  }

  if (mac) {
    const oui = mac.slice(0, 8);
    const printerVendors = ['00:00:aa', '00:17:c5', '00:25:b3', '00:80:77', 'cc:04:96', '00:15:99'];
    if (printerVendors.some(v => oui.startsWith(v))) {
      type = 'printer';
      notesAdd = ` (Принтер по MAC: ${mac})`;
    }
  }

  return { type, notesAdd };
}

async function runNetworkScan({ autoCreateNew = true } = {}) {
  if (isScanning) return { status: 'already_running' };
  isScanning = true;

  const stats = {
    scannedIps: 0,
    onlineCount: 0,
    autoCreated: 0,
    autoMoved: 0,
    linkedExisting: 0
  };

  try {
    const insertHistory = db.prepare(`
      INSERT INTO device_history (device_id, action, description)
      VALUES (?, ?, ?)
    `);

    for (const netConfig of SUBNETS) {
      if (!netConfig.branch || !netConfig.settlement) continue;

      const targetSettlementId = ensureSettlementId(netConfig.branch, netConfig.settlement);
      const ipsToScan = getIpsFromConfig(netConfig);
      if (ipsToScan.length === 0) continue;

      const BATCH_SIZE = 50;
      for (let i = 0; i < ipsToScan.length; i += BATCH_SIZE) {
        const batch = ipsToScan.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(
          batch.map(async (ip) => ({ ip, alive: await pingHost(ip) }))
        );

        const arpTable = await getArpTable();

        for (const { ip, alive } of results) {
          stats.scannedIps++;
          const mac = arpTable.get(ip) || null;

          if (alive) {
            stats.onlineCount++;
            const hostname = await resolveHostname(ip);

            // Если это устройство было специально удалено пользователем в корзину — не трогаем и не пересоздаем его
            if (mac) {
              const inTrashByMac = db.prepare('SELECT id FROM devices WHERE lower(mac_address) = ? AND deleted_at IS NOT NULL').get(mac.toLowerCase());
              if (inTrashByMac) continue;
            }
            const inTrashByIp = db.prepare('SELECT id FROM devices WHERE ip_address = ? AND deleted_at IS NOT NULL').get(ip);
            if (inTrashByIp) continue;

            let existingDevice = null;
            if (mac) {
              existingDevice = db.prepare('SELECT * FROM devices WHERE lower(mac_address) = ? AND deleted_at IS NULL').get(mac.toLowerCase());
            }

            if (!existingDevice && hostname) {
              existingDevice = findDeviceByHostname(hostname, targetSettlementId);
            }

            if (!existingDevice) {
              existingDevice = db.prepare('SELECT * FROM devices WHERE ip_address = ? AND deleted_at IS NULL').get(ip);
            }

            if (existingDevice) {
              const needsMove = existingDevice.settlement_branch_id !== targetSettlementId;
              const ipChanged = existingDevice.ip_address !== ip;

              const staleAuto = db.prepare(`
                SELECT id FROM devices 
                WHERE ip_address = ? AND id != ? AND inventory_number LIKE 'AUTO-%' AND deleted_at IS NULL
              `).get(ip, existingDevice.id);

              if (staleAuto) {
                db.prepare('DELETE FROM devices WHERE id = ?').run(staleAuto.id);
              } else {
                db.prepare('UPDATE devices SET ip_address = NULL, is_online = 0 WHERE ip_address = ? AND id != ? AND deleted_at IS NULL')
                  .run(ip, existingDevice.id);
              }

              const shouldUpdateName = hostname && /^Устройство\s+\d+\./i.test(existingDevice.name);
              const updatedName = shouldUpdateName ? hostname : existingDevice.name;

              db.prepare(`
                UPDATE devices 
                SET name = ?,
                    ip_address = ?, 
                    mac_address = COALESCE(?, mac_address), 
                    settlement_branch_id = ?, 
                    is_online = 1, 
                    last_seen = datetime('now'), 
                    updated_at = datetime('now')
                WHERE id = ?
              `).run(updatedName, ip, mac, targetSettlementId, existingDevice.id);

              if (needsMove) {
                insertHistory.run(
                  existingDevice.id,
                  'UPDATED',
                  `Авто-перемещение по сети в "${netConfig.settlement}" (IP: ${ip}${hostname ? ', Имя: ' + hostname : ''})`
                );
                stats.autoMoved++;
              } else if (ipChanged) {
                insertHistory.run(
                  existingDevice.id,
                  'UPDATED',
                  `Обновлён IP по DHCP${hostname ? ' для ' + hostname : ''}: "${existingDevice.ip_address || '—'}" → "${ip}"`
                );
                stats.linkedExisting++;
              }
            } else if (autoCreateNew) {
              const { type, notesAdd } = await detectDeviceTypeAndVendor(ip, mac);
              const devName = hostname ? hostname : `Устройство ${ip}`;
              const autoInv = mac
                ? `AUTO-${mac.replace(/:/g, '').slice(-6).toUpperCase()}`
                : (hostname ? `AUTO-${hostname.toUpperCase()}` : `AUTO-${ip.replace(/\./g, '-')}`);

              const dupInv = db.prepare('SELECT id FROM devices WHERE settlement_branch_id = ? AND inventory_number = ? AND deleted_at IS NULL')
                .get(targetSettlementId, autoInv);

              if (!dupInv) {
                const info = db.prepare(`
                  INSERT INTO devices (
                    settlement_branch_id, type, inventory_number, name, ip_address, mac_address,
                    status, is_online, last_seen, notes
                  ) VALUES (?, ?, ?, ?, ?, ?, 'working', 1, datetime('now'), ?)
                `).run(targetSettlementId, type, autoInv, devName, ip, mac, `Обнаружено сканером${notesAdd}`);

                const rangeLabel = netConfig.subnet || `${netConfig.startIp}-${netConfig.endIp}`;
                insertHistory.run(
                  info.lastInsertRowid,
                  'CREATED',
                  `Автоматически обнаружено в сети ${rangeLabel} (Имя: ${devName}, IP: ${ip}${mac ? ', MAC: ' + mac : ''})`
                );
                stats.autoCreated++;
              }
            }
          } else {
            db.prepare('UPDATE devices SET is_online = 0 WHERE ip_address = ? AND deleted_at IS NULL').run(ip);
            if (mac) {
              db.prepare('UPDATE devices SET is_online = 0 WHERE lower(mac_address) = ? AND deleted_at IS NULL').run(mac.toLowerCase());
            }
          }
        }
      }
    }

    return { status: 'completed', ...stats };
  } finally {
    isScanning = false;
  }
}

module.exports = {
  runNetworkScan,
  findSubnetConfigByIp,
  ensureSettlementId,
  isScanning: () => isScanning
};