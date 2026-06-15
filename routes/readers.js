const express = require('express');
const { db } = require('../db/database');
const { requireRole } = require('../utils/auth');

const router = express.Router();

router.get('/', requireRole('librarian', 'admin'), (req, res) => {
  const q = (req.query.q || '').trim();
  let rows;

  if (q) {
    const pattern = `%${q}%`;
    rows = db
      .prepare(
        `SELECT * FROM readers
         WHERE name LIKE ? OR class_name LIKE ?
         ORDER BY class_name, name`
      )
      .all(pattern, pattern);
  } else {
    rows = db.prepare('SELECT * FROM readers ORDER BY class_name, name').all();
  }

  res.json(rows);
});

router.post('/', requireRole('librarian', 'admin'), (req, res) => {
  const { name, class_name } = req.body;

  if (!name?.trim() || !class_name?.trim()) {
    res.status(400).json({ error: 'Укажите ФИО и класс' });
    return;
  }

  const result = db
    .prepare('INSERT INTO readers (name, class_name) VALUES (?, ?)')
    .run(name.trim(), class_name.trim());

  const reader = db.prepare('SELECT * FROM readers WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(reader);
});

router.delete('/:id', requireRole('librarian', 'admin'), (req, res) => {
  const activeLoans = db
    .prepare('SELECT COUNT(*) AS n FROM loans WHERE reader_id = ? AND return_date IS NULL')
    .get(req.params.id).n;

  if (activeLoans > 0) {
    res.status(400).json({ error: 'Нельзя удалить читателя с активной выдачей' });
    return;
  }

  const result = db.prepare('DELETE FROM readers WHERE id = ?').run(req.params.id);
  if (result.changes === 0) {
    res.status(404).json({ error: 'Читатель не найден' });
    return;
  }
  res.status(204).send();
});

module.exports = router;
