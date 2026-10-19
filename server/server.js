const express = require('express');
const path = require('path');

const branchesRouter = require('./routes/branches');
const settlementsRouter = require('./routes/settlements');
const devicesRouter = require('./routes/devices');
const dashboardRouter = require('./routes/dashboard');
const importRouter = require('./routes/import');

const app = express();
const PORT = process.env.PORT || 3001;

// Увеличиваем лимит, например, до 10 мегабайт (или больше при необходимости)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

app.use(express.json());

app.use('/api/branches', branchesRouter);
app.use('/api/settlements', settlementsRouter);
app.use('/api/devices', devicesRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/import', importRouter);

// Отдаём фронтенд (статические файлы)
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Учёт ПК и принтеров запущен: http://localhost:${PORT}`);
});
