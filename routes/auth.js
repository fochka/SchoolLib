const express = require('express');
const { db } = require('../db/database');
const {
  clearSession,
  createSession,
  hashPassword,
  logAction,
  publicUser,
  requireUser,
  verifyPassword,
} = require('../utils/auth');

const router = express.Router();

router.get('/me', (req, res) => {
  res.json({ user: publicUser(req.user) });
});

router.post('/register', (req, res) => {
  const { name, email, password, class_name } = req.body;

  if (!name?.trim() || !email?.trim() || !password || password.length < 4) {
    res.status(400).json({ error: 'Укажите имя, email и пароль от 4 символов' });
    return;
  }

  try {
    const result = db
      .prepare(
        `INSERT INTO users (name, email, password_hash, role, class_name)
         VALUES (?, ?, ?, 'student', ?)`
      )
      .run(name.trim(), email.trim().toLowerCase(), hashPassword(password), class_name?.trim() || null);

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    const token = createSession(user.id);
    logAction(user.id, 'auth.register', `Зарегистрирован пользователь ${user.email}`);
    res.cookie('schoollib_session', token, { httpOnly: true, sameSite: 'lax', maxAge: 7 * 86400000 });
    res.status(201).json({ user: publicUser(user) });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      res.status(400).json({ error: 'Пользователь с таким email уже есть' });
      return;
    }
    throw err;
  }
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').trim().toLowerCase());

  if (!user || !verifyPassword(password || '', user.password_hash)) {
    res.status(400).json({ error: 'Неверный email или пароль' });
    return;
  }
  if (user.is_blocked) {
    res.status(403).json({ error: 'Учётная запись заблокирована' });
    return;
  }

  const token = createSession(user.id);
  logAction(user.id, 'auth.login', `Вход ${user.email}`);
  res.cookie('schoollib_session', token, { httpOnly: true, sameSite: 'lax', maxAge: 7 * 86400000 });
  res.json({ user: publicUser(user) });
});

router.patch('/me', requireUser, (req, res) => {
  const name = String(req.body.name || '').trim();
  const className = String(req.body.class_name || '').trim();

  if (!name) {
    res.status(400).json({ error: 'Укажите ФИО' });
    return;
  }

  db.prepare('UPDATE users SET name = ?, class_name = ? WHERE id = ?').run(
    name,
    className || null,
    req.user.id
  );

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  logAction(req.user.id, 'profile.update', 'Пользователь обновил профиль');
  res.json({ user: publicUser(user) });
});

router.patch('/me/password', requireUser, (req, res) => {
  const { current_password, new_password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

  if (!verifyPassword(current_password || '', user.password_hash)) {
    res.status(400).json({ error: 'Текущий пароль указан неверно' });
    return;
  }
  if (!new_password || new_password.length < 4) {
    res.status(400).json({ error: 'Новый пароль должен быть не короче 4 символов' });
    return;
  }

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(new_password), req.user.id);
  logAction(req.user.id, 'profile.password', 'Пользователь изменил пароль');
  res.status(204).send();
});

router.post('/logout', requireUser, (req, res) => {
  logAction(req.user.id, 'auth.logout', `Выход ${req.user.email}`);
  clearSession(req.sessionToken);
  res.clearCookie('schoollib_session');
  res.status(204).send();
});

module.exports = router;
