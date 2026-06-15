const crypto = require('crypto');
const { db, hashPassword, addLog } = require('../db/database');

const roles = ['student', 'teacher', 'librarian', 'admin'];
const roleNames = {
  student: 'Ученик',
  teacher: 'Учитель',
  librarian: 'Библиотекарь',
  admin: 'Администратор',
};

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(
    header
      .split(';')
      .map((part) => part.trim().split('='))
      .filter((pair) => pair.length === 2)
      .map(([key, value]) => [key, decodeURIComponent(value)])
  );
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    role_name: roleNames[user.role] || user.role,
    class_name: user.class_name,
    is_blocked: user.is_blocked,
  };
}

function verifyPassword(password, savedHash) {
  const [salt, hash] = String(savedHash || '').split(':');
  if (!salt || !hash) return false;
  const actual = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(actual));
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare(
    `INSERT INTO sessions (token, user_id, expires_at)
     VALUES (?, ?, datetime('now', '+7 days'))`
  ).run(token, userId);
  return token;
}

function clearSession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function loadUserByToken(token) {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.*
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND datetime(s.expires_at) > datetime('now')`
    )
    .get(token);
  if (!row || row.is_blocked) return null;
  return row;
}

function attachUser(req, res, next) {
  const cookies = parseCookies(req);
  req.sessionToken = cookies.schoollib_session;
  req.user = loadUserByToken(req.sessionToken);
  next();
}

function requireUser(req, res, next) {
  if (!req.user) {
    res.status(401).json({ error: 'Войдите в систему' });
    return;
  }
  next();
}

function requireRole(...allowed) {
  return (req, res, next) => {
    if (!req.user) {
      res.status(401).json({ error: 'Войдите в систему' });
      return;
    }
    if (!allowed.includes(req.user.role)) {
      res.status(403).json({ error: 'Недостаточно прав' });
      return;
    }
    next();
  };
}

function canManageBooks(user) {
  return user && ['librarian', 'admin'].includes(user.role);
}

function canManageReservations(user) {
  return user && ['librarian', 'admin'].includes(user.role);
}

function logAction(userId, action, details) {
  addLog(userId, action, details);
}

module.exports = {
  roles,
  roleNames,
  hashPassword,
  verifyPassword,
  createSession,
  clearSession,
  publicUser,
  attachUser,
  requireUser,
  requireRole,
  canManageBooks,
  canManageReservations,
  logAction,
};
