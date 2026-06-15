const express = require('express');
const { db, expireOldReservations } = require('../db/database');
const { logAction, requireRole, requireUser } = require('../utils/auth');

const router = express.Router();

const listSelect = `
  SELECT
    r.*,
    b.title AS book_title,
    b.author AS book_author,
    b.genre AS book_genre,
    u.name AS user_name,
    u.email AS user_email,
    u.role AS user_role,
    u.class_name AS user_class
  FROM reservations r
  JOIN books b ON b.id = r.book_id
  JOIN users u ON u.id = r.user_id
`;

function getReservation(id) {
  return db.prepare(`${listSelect} WHERE r.id = ?`).get(id);
}

router.get('/mine', requireUser, (req, res) => {
  expireOldReservations();
  const rows = db
    .prepare(`${listSelect} WHERE r.user_id = ? ORDER BY r.created_at DESC`)
    .all(req.user.id);
  res.json(rows);
});

router.get('/', requireRole('librarian', 'admin'), (req, res) => {
  expireOldReservations();
  const status = req.query.status;
  const params = [];
  let where = '';
  if (status) {
    where = 'WHERE r.status = ?';
    params.push(status);
  }
  const rows = db.prepare(`${listSelect} ${where} ORDER BY r.created_at DESC`).all(...params);
  res.json(rows);
});

router.post('/', requireUser, (req, res) => {
  try {
  expireOldReservations();
  const bookId = Number(req.body.book_id);
  if (!bookId) {
    res.status(400).json({ error: 'Выберите книгу' });
    return;
  }

  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId);
  if (!book) {
    res.status(404).json({ error: 'Книга не найдена' });
    return;
  }
  if (book.copies_available < 1) {
    res.status(400).json({ error: 'Нет свободных экземпляров' });
    return;
  }

  const already = db
    .prepare(
      `SELECT id FROM reservations
       WHERE user_id = ? AND book_id = ? AND status IN ('reserved', 'issued')`
    )
    .get(req.user.id, bookId);
  if (already) {
    res.status(400).json({ error: 'У вас уже есть активная бронь или выдача этой книги' });
    return;
  }

  const id = db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO reservations (user_id, book_id, quantity, reserved_until)
         VALUES (?, ?, 1, datetime('now', '+3 days'))`
      )
      .run(req.user.id, bookId);
    db.prepare('UPDATE books SET copies_available = copies_available - 1 WHERE id = ?').run(bookId);
    return result.lastInsertRowid;
  })();

  logAction(req.user.id, 'reservation.create', `Бронь книги "${book.title}"`);
  res.status(201).json(getReservation(id));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка бронирования', details: err.message || String(err) });
  }
});

router.post('/mass', requireRole('teacher', 'librarian', 'admin'), (req, res) => {
  expireOldReservations();
  const bookId = Number(req.body.book_id);
  const className = String(req.body.class_name || '').trim();
  const count = Math.max(1, Number(req.body.count) || 1);

  if (!bookId || !className) {
    res.status(400).json({ error: 'Выберите книгу и класс' });
    return;
  }

  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId);
  if (!book) {
    res.status(404).json({ error: 'Книга не найдена' });
    return;
  }
  if (book.copies_available < count) {
    res.status(400).json({ error: `Доступно только ${book.copies_available} экземпляров` });
    return;
  }

  const id = db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO reservations (user_id, book_id, quantity, reserved_until)
         VALUES (?, ?, ?, datetime('now', '+3 days'))`
      )
      .run(req.user.id, bookId, count);
    db.prepare('UPDATE books SET copies_available = copies_available - ? WHERE id = ?').run(count, bookId);
    return result.lastInsertRowid;
  })();

  logAction(req.user.id, 'reservation.mass', `Массовая бронь "${book.title}" для ${className}: ${count} шт.`);
  const row = getReservation(id);
  row.mass_class = className;
  res.status(201).json(row);
});

router.patch('/:id/cancel', requireUser, (req, res) => {
  const reservation = db.prepare('SELECT * FROM reservations WHERE id = ?').get(req.params.id);
  if (!reservation) {
    res.status(404).json({ error: 'Бронь не найдена' });
    return;
  }
  if (reservation.user_id !== req.user.id && !['librarian', 'admin'].includes(req.user.role)) {
    res.status(403).json({ error: 'Недостаточно прав' });
    return;
  }
  if (reservation.status !== 'reserved') {
    res.status(400).json({ error: 'Отменить можно только активную бронь' });
    return;
  }

  db.transaction(() => {
    db.prepare(
      `UPDATE reservations
       SET status = 'canceled', canceled_at = datetime('now')
       WHERE id = ?`
    ).run(req.params.id);
    db.prepare('UPDATE books SET copies_available = copies_available + ? WHERE id = ?').run(
      reservation.quantity || 1,
      reservation.book_id
    );
  })();

  logAction(req.user.id, 'reservation.cancel', `Отменена бронь #${reservation.id}`);
  res.json(getReservation(req.params.id));
});

router.patch('/:id/issue', requireRole('librarian', 'admin'), (req, res) => {
  const reservation = db.prepare('SELECT * FROM reservations WHERE id = ?').get(req.params.id);
  if (!reservation) {
    res.status(404).json({ error: 'Бронь не найдена' });
    return;
  }
  if (reservation.status !== 'reserved') {
    res.status(400).json({ error: 'Выдать можно только активную бронь' });
    return;
  }

  db.prepare(
    `UPDATE reservations
     SET status = 'issued', issued_at = datetime('now'), due_at = datetime('now', '+14 days')
     WHERE id = ?`
  ).run(req.params.id);
  logAction(req.user.id, 'reservation.issue', `Выдана бронь #${reservation.id}`);
  res.json(getReservation(req.params.id));
});

router.patch('/:id/return', requireRole('librarian', 'admin'), (req, res) => {
  const reservation = db.prepare('SELECT * FROM reservations WHERE id = ?').get(req.params.id);
  if (!reservation) {
    res.status(404).json({ error: 'Выдача не найдена' });
    return;
  }
  if (reservation.status !== 'issued') {
    res.status(400).json({ error: 'Вернуть можно только выданную книгу' });
    return;
  }

  db.transaction(() => {
    db.prepare(
      `UPDATE reservations
       SET status = 'returned', returned_at = datetime('now')
       WHERE id = ?`
    ).run(req.params.id);
    db.prepare('UPDATE books SET copies_available = copies_available + ? WHERE id = ?').run(
      reservation.quantity || 1,
      reservation.book_id
    );
  })();

  logAction(req.user.id, 'reservation.return', `Возвращена выдача #${reservation.id}`);
  res.json(getReservation(req.params.id));
});

module.exports = router;
