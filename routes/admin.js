const express = require('express');
const { db } = require('../db/database');
const { hashPassword, logAction, publicUser, requireRole, roles } = require('../utils/auth');

const router = express.Router();

router.use(requireRole('admin'));

router.get('/users', (req, res) => {
  const rows = db.prepare('SELECT * FROM users ORDER BY created_at DESC').all();
  res.json(rows.map(publicUser));
});

router.post('/users', (req, res) => {
  const { name, email, password, role, class_name } = req.body;
  if (!name?.trim() || !email?.trim() || !password) {
    res.status(400).json({ error: 'Укажите имя, email и пароль' });
    return;
  }
  if (!roles.includes(role)) {
    res.status(400).json({ error: 'Некорректная роль' });
    return;
  }

  try {
    const result = db
      .prepare(
        `INSERT INTO users (name, email, password_hash, role, class_name)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        name.trim(),
        email.trim().toLowerCase(),
        hashPassword(password),
        role,
        class_name?.trim() || null
      );
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    logAction(req.user.id, 'admin.user.create', `Создан пользователь ${user.email}`);
    res.status(201).json(publicUser(user));
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      res.status(400).json({ error: 'Пользователь с таким email уже есть' });
      return;
    }
    throw err;
  }
});

router.patch('/users/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!existing) {
    res.status(404).json({ error: 'Пользователь не найден' });
    return;
  }

  const role = roles.includes(req.body.role) ? req.body.role : existing.role;
  const isBlocked = req.body.is_blocked === undefined ? existing.is_blocked : req.body.is_blocked ? 1 : 0;
  db.prepare(
    `UPDATE users
     SET name = ?, role = ?, class_name = ?, is_blocked = ?
     WHERE id = ?`
  ).run(
    req.body.name?.trim() || existing.name,
    role,
    req.body.class_name?.trim() || null,
    isBlocked,
    req.params.id
  );

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  logAction(req.user.id, 'admin.user.update', `Изменён пользователь ${user.email}`);
  res.json(publicUser(user));
});

router.get('/logs', (req, res) => {
  const rows = db
    .prepare(
      `SELECT l.*, u.name AS user_name, u.email AS user_email
       FROM system_logs l
       LEFT JOIN users u ON u.id = l.user_id
       ORDER BY l.created_at DESC
       LIMIT 300`
    )
    .all();
  res.json(rows);
});

module.exports = router;
