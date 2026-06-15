const express = require('express');
const { db } = require('../db/database');
const { logAction, requireUser } = require('../utils/auth');

const router = express.Router();

router.get('/', requireUser, (req, res) => {
  const rows = db
    .prepare(
      `SELECT b.*, f.created_at AS favorite_at
       FROM favorites f
       JOIN books b ON b.id = f.book_id
       WHERE f.user_id = ?
       ORDER BY f.created_at DESC`
    )
    .all(req.user.id);
  res.json(rows);
});

router.post('/:bookId', requireUser, (req, res) => {
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.bookId);
  if (!book) {
    res.status(404).json({ error: 'Книга не найдена' });
    return;
  }

  db.prepare('INSERT OR IGNORE INTO favorites (user_id, book_id) VALUES (?, ?)').run(
    req.user.id,
    req.params.bookId
  );
  logAction(req.user.id, 'favorite.add', `Добавлено в избранное "${book.title}"`);
  res.status(201).json({ ok: true });
});

router.delete('/:bookId', requireUser, (req, res) => {
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.bookId);
  db.prepare('DELETE FROM favorites WHERE user_id = ? AND book_id = ?').run(req.user.id, req.params.bookId);
  if (book) logAction(req.user.id, 'favorite.remove', `Удалено из избранного "${book.title}"`);
  res.status(204).send();
});

module.exports = router;
