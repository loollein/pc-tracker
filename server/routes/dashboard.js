const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', (req, res) => {
  const totals = db.prepare(`
    SELECT
      COUNT(*) AS total_devices,
      SUM(CASE WHEN type = 'pc' THEN 1 ELSE 0 END) AS total_pc,
      SUM(CASE WHEN type = 'printer' THEN 1 ELSE 0 END) AS total_printers,
      SUM(CASE WHEN type = 'mfu' THEN 1 ELSE 0 END) AS total_mfu,
      SUM(CASE WHEN type = 'network' THEN 1 ELSE 0 END) AS total_network,
      SUM(CASE WHEN type = 'spm' THEN 1 ELSE 0 END) AS total_spm,
      SUM(CASE WHEN type = 'sempl' THEN 1 ELSE 0 END) AS total_sempl,
      SUM(CASE WHEN status = 'working' THEN 1 ELSE 0 END) AS total_working,
      SUM(CASE WHEN status = 'repair' THEN 1 ELSE 0 END) AS total_repair,
      SUM(CASE WHEN status = 'decommissioned' THEN 1 ELSE 0 END) AS total_decommissioned
    FROM devices
  `).get();

  // НОВЫЙ ЗАПРОС: Считаем статистику по операционным системам
  const osStats = db.prepare(`
    SELECT
      CASE WHEN os IS NULL OR trim(os) = '' THEN 'Не указано' ELSE trim(os) END AS os_name,
      COUNT(id) AS count
    FROM devices
    WHERE type = 'pc' OR type = 'spm' -- Считаем ОС только для тех устройств, где она имеет смысл
    GROUP BY os_name
    ORDER BY count DESC
  `).all();

  const byMunicipalBranch = db.prepare(`
    SELECT
      mb.id, mb.name,
      COUNT(d.id) AS devices_count,
      SUM(CASE WHEN d.type = 'pc' THEN 1 ELSE 0 END) AS pc_count,
      SUM(CASE WHEN d.type = 'printer' THEN 1 ELSE 0 END) AS printer_count,
      SUM(CASE WHEN d.type = 'mfu' THEN 1 ELSE 0 END) AS mfu_count,
      SUM(CASE WHEN d.type = 'network' THEN 1 ELSE 0 END) AS network_count,
      SUM(CASE WHEN d.type = 'spm' THEN 1 ELSE 0 END) AS spm_count,
      SUM(CASE WHEN d.type = 'sempl' THEN 1 ELSE 0 END) AS sempl_count,
      SUM(CASE WHEN d.status = 'working' THEN 1 ELSE 0 END) AS working_count,
      SUM(CASE WHEN d.status = 'repair' THEN 1 ELSE 0 END) AS repair_count,
      SUM(CASE WHEN d.status = 'decommissioned' THEN 1 ELSE 0 END) AS decommissioned_count
    FROM municipal_branches mb
    LEFT JOIN settlement_branches sb ON sb.municipal_branch_id = mb.id
    LEFT JOIN devices d ON d.settlement_branch_id = sb.id
    GROUP BY mb.id
    ORDER BY mb.name COLLATE NOCASE
  `).all();

  const bySettlement = db.prepare(`
    SELECT
      sb.id, sb.name, mb.id AS municipal_branch_id, mb.name AS municipal_branch_name,
      COUNT(d.id) AS devices_count,
      SUM(CASE WHEN d.type = 'pc' THEN 1 ELSE 0 END) AS pc_count,
      SUM(CASE WHEN d.type = 'printer' THEN 1 ELSE 0 END) AS printer_count,
      SUM(CASE WHEN d.type = 'mfu' THEN 1 ELSE 0 END) AS mfu_count,
      SUM(CASE WHEN d.type = 'network' THEN 1 ELSE 0 END) AS network_count,
      SUM(CASE WHEN d.type = 'spm' THEN 1 ELSE 0 END) AS spm_count,
      SUM(CASE WHEN d.type = 'sempl' THEN 1 ELSE 0 END) AS sempl_count,
      SUM(CASE WHEN d.status = 'working' THEN 1 ELSE 0 END) AS working_count,
      SUM(CASE WHEN d.status = 'repair' THEN 1 ELSE 0 END) AS repair_count,
      SUM(CASE WHEN d.status = 'decommissioned' THEN 1 ELSE 0 END) AS decommissioned_count
    FROM settlement_branches sb
    JOIN municipal_branches mb ON mb.id = sb.municipal_branch_id
    LEFT JOIN devices d ON d.settlement_branch_id = sb.id
    GROUP BY sb.id
    ORDER BY mb.name COLLATE NOCASE, sb.name COLLATE NOCASE
  `).all();

  const repairList = db.prepare(`
    SELECT d.id, d.inventory_number, d.name, d.type, d.ip_address, d.updated_at,
           sb.name AS settlement_name, mb.name AS branch_name
    FROM devices d
    JOIN settlement_branches sb ON sb.id = d.settlement_branch_id
    JOIN municipal_branches mb ON mb.id = sb.municipal_branch_id
    WHERE d.status = 'repair'
    ORDER BY d.updated_at DESC
  `).all();

  // Не забываем передать osStats на фронтенд
  res.json({ totals, byMunicipalBranch, bySettlement, repairList, osStats });
});

module.exports = router;