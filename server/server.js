// server/server.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('./db');

const branchesRouter = require('./routes/branches');
const settlementsRouter = require('./routes/settlements');
const devicesRouter = require('./routes/devices');
const dashboardRouter = require('./routes/dashboard');
const importRouter = require('./routes/import');
const { runNetworkScan, isScanning } = require('./scanner');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

app.use('/api/branches', branchesRouter);
app.use('/api/settlements', settlementsRouter);
app.use('/api/devices', devicesRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/import', importRouter);

// 1. Глобальный журнал всех событий (Аудит)
app.get('/api/history', (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 150;
    const history = db.prepare(`
      SELECT h.*, 
             COALESCE(d.name, 'Системное событие / Удалено') AS device_name, 
             d.inventory_number,
             sb.name AS settlement_name,
             mb.name AS branch_name
      FROM device_history h
      LEFT JOIN devices d ON d.id = h.device_id
      LEFT JOIN settlement_branches sb ON sb.id = d.settlement_branch_id
      LEFT JOIN municipal_branches mb ON mb.id = sb.municipal_branch_id
      ORDER BY h.created_at DESC, h.id DESC
      LIMIT ?
    `).all(limit);
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка чтения журнала: ' + err.message });
  }
});

// 2. Горячий бэкап базы данных SQLite (безопасно при включенном WAL)
app.get('/api/backup', async (req, res) => {
  const dateStr = new Date().toISOString().slice(0, 10);
  const downloadName = `tracker_backup_${dateStr}.db`;
  const tempFilePath = path.join(os.tmpdir(), `tracker_backup_${Date.now()}.db`);

  try {
    await db.backup(tempFilePath);

    db.prepare(`
      INSERT INTO device_history (device_id, action, description)
      VALUES (NULL, 'BACKUP', ?)
    `).run(`Выгружена резервная копия базы данных (${downloadName})`);

    res.download(tempFilePath, downloadName, (err) => {
      fs.unlink(tempFilePath, () => {});
      if (err && !res.headersSent) {
        res.status(500).json({ error: 'Ошибка отправки файла бэкапа' });
      }
    });
  } catch (err) {
    fs.unlink(tempFilePath, () => {});
    res.status(500).json({ error: 'Ошибка создания резервной копии БД: ' + err.message });
  }
});

// 3. Ручной запуск сканирования подсетей по кнопке с фронтенда
app.post('/api/scan', async (req, res) => {
  if (isScanning()) {
    return res.status(409).json({ error: 'Сканирование уже идёт, подождите...' });
  }
  try {
    const result = await runNetworkScan({ autoCreateNew: true });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сканирования: ' + err.message });
  }
});

// Автоматическое фоновое сканирование каждые 15 минут
setInterval(() => {
  runNetworkScan({ autoCreateNew: true }).catch(err => console.error('Ошибка авто-скана:', err));
}, 15 * 60 * 1000);

// Отдаём фронтенд (статические файлы)
app.use(express.static(path.join(__dirname, '..', 'public')));

// 4. Все остальные несуществующие /api/* строго возвращают 404 JSON
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found' });
});

// 5. SPA-роутинг для всех остальных GET-запросов
app.get(/^\/(?!api\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Учёт ПК и принтеров запущен: http://localhost:${PORT}`);
});