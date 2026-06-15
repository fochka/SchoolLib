const express = require('express');
const { db } = require('../db/database');
const { logAction, requireRole } = require('../utils/auth');

const router = express.Router();

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM events ORDER BY event_date, created_at DESC').all();
  res.json(rows);
});

router.post('/', requireRole('librarian', 'admin'), (req, res) => {
  const { title, description, event_date } = req.body;
  if (!title?.trim()) {
    res.status(400).json({ error: 'Укажите название события' });
    return;
  }
  const result = db
    .prepare('INSERT INTO events (title, description, event_date) VALUES (?, ?, ?)')
    .run(title.trim(), description?.trim() || null, event_date || null);
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(result.lastInsertRowid);
  logAction(req.user.id, 'event.create', `Создано событие "${event.title}"`);
  res.status(201).json(event);
});

router.delete('/:id', requireRole('librarian', 'admin'), (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  const result = db.prepare('DELETE FROM events WHERE id = ?').run(req.params.id);
  if (!result.changes) {
    res.status(404).json({ error: 'Событие не найдено' });
    return;
  }
  logAction(req.user.id, 'event.delete', `Удалено событие "${event.title}"`);
  res.status(204).send();
});

module.exports = router;
