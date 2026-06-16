const path = require('path');
const os = require('os');
const express = require('express');

require('./db/database');

const { attachUser } = require('./utils/auth');
const authRouter = require('./routes/auth');
const booksRouter = require('./routes/books');
const readersRouter = require('./routes/readers');
const loansRouter = require('./routes/loans');
const reservationsRouter = require('./routes/reservations');
const favoritesRouter = require('./routes/favorites');
const reportsRouter = require('./routes/reports');
const adminRouter = require('./routes/admin');
const eventsRouter = require('./routes/events');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

function getLocalUrls() {
  const addresses = [];
  const interfaces = os.networkInterfaces();

  for (const items of Object.values(interfaces)) {
    for (const item of items || []) {
      if (item.family === 'IPv4' && !item.internal) {
        addresses.push(item.address);
      }
    }
  }

  return addresses.sort((a, b) => localAddressPriority(a) - localAddressPriority(b)).map((address) => `http://${address}:${PORT}`);
}

function localAddressPriority(address) {
  if (address.startsWith('192.168.')) return 1;
  if (address.startsWith('10.')) return 2;

  const parts = address.split('.').map(Number);
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return 3;

  return 10;
}

function getPublicOrigin() {
  return process.env.PUBLIC_URL || getLocalUrls()[0] || `http://localhost:${PORT}`;
}

app.use(express.json());
app.use(attachUser);

app.get('/cabinet.html', (req, res, next) => {
  if (!req.user) {
    res.redirect('/?auth=required');
    return;
  }
  res.sendFile(path.join(__dirname, 'public', 'cabinet.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.get('/api/config', (req, res) => {
  res.json({
    publicOrigin: getPublicOrigin(),
    localUrls: getLocalUrls(),
  });
});

app.use('/api/auth', authRouter);
app.use('/api/books', booksRouter);
app.use('/api/readers', readersRouter);
app.use('/api/loans', loansRouter);
app.use('/api/reservations', reservationsRouter);
app.use('/api/favorites', favoritesRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/admin', adminRouter);
app.use('/api/events', eventsRouter);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({
    error: 'Внутренняя ошибка сервера',
    details: process.env.NODE_ENV === 'production' ? undefined : err.message || String(err),
  });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`Школьная библиотека: http://localhost:${PORT}`);
  const localUrls = getLocalUrls();
  if (localUrls.length) {
    console.log('Адреса для телефона в той же Wi-Fi сети:');
    for (const url of localUrls) console.log(`- ${url}`);
  }
});
server.ref();

// В учебном проекте оставляем явный таймер, чтобы процесс Node.js не завершался
// в некоторых терминалах Windows сразу после старта HTTP-сервера.
const keepAlive = setInterval(() => {}, 60 * 60 * 1000);

process.on('SIGTERM', () => {
  clearInterval(keepAlive);
  server.close(() => process.exit(0));
});
process.on('SIGINT', () => {
  clearInterval(keepAlive);
  server.close(() => process.exit(0));
});
