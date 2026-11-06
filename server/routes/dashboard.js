// server/routes/dashboard.js
const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', (req, res) => {
  const totals = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM municipal_branches) AS total_municipal_branches,
      (SELECT COUNT(*) FROM settlement_branches) AS total_settlements,
      COUNT(*) AS total_devices,
      COALESCE(SUM(CASE WHEN type = 'pc' THEN 1 ELSE 0 END), 0) AS total_pc,
      COALESCE(SUM(CASE WHEN type = 'printer' THEN 1 ELSE 0 END), 0) AS total_printers,
      COALESCE(SUM(CASE WHEN type = 'mfu' THEN 1 ELSE 0 END), 0) AS total_mfu,
      COALESCE(SUM(CASE WHEN type = 'network' THEN 1 ELSE 0 END), 0) AS total_network,
      COALESCE(SUM(CASE WHEN type = 'spm' THEN 1 ELSE 0 END), 0) AS total_spm,
      COALESCE(SUM(CASE WHEN type = 'sempl' THEN 1 ELSE 0 END), 0) AS total_sempl,
      COALESCE(SUM(CASE WHEN status = 'working' THEN 1 ELSE 0 END), 0) AS total_working,
      COALESCE(SUM(CASE WHEN status = 'repair' THEN 1 ELSE 0 END), 0) AS total_repair,
      COALESCE(SUM(CASE WHEN status = 'decommissioned' THEN 1 ELSE 0 END), 0) AS total_decommissioned
    FROM devices
    WHERE deleted_at IS NULL
  `).get();

  const osStats = db.prepare(`
    SELECT trim(os) AS os_name, COUNT(*) AS count
    FROM devices
    WHERE deleted_at IS NULL AND os IS NOT NULL AND trim(os) != ''
    GROUP BY trim(os)
    ORDER BY count DESC, os_name COLLATE NOCASE ASC
  `).all();

  const byMunicipalBranch = db.prepare(`
    SELECT
      mb.id,
      mb.name,
      COUNT(DISTINCT sb.id) AS settlements_count,
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
    LEFT JOIN devices d ON d.settlement_branch_id = sb.id AND d.deleted_at IS NULL
    GROUP BY mb.id
    ORDER BY mb.name COLLATE NOCASE
  `).all();

  const bySettlement = db.prepare(`
    SELECT
      sb.id,
      sb.name,
      sb.municipal_branch_id,
      mb.name AS municipal_branch_name,
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
    LEFT JOIN devices d ON d.settlement_branch_id = sb.id AND d.deleted_at IS NULL
    GROUP BY sb.id
    ORDER BY mb.name COLLATE NOCASE, sb.name COLLATE NOCASE
  `).all();

  res.json({
    totals,
    osStats,
    byMunicipalBranch,
    bySettlement
  });
});

module.exports = router;