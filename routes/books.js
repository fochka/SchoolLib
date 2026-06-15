const express = require('express');
const { db } = require('../db/database');
const { canManageBooks, logAction, requireRole } = require('../utils/auth');

const router = express.Router();

router.get('/', (req, res) => {
  const q = (req.query.q || '').trim();
  const genre = (req.query.genre || '').trim();
  const year = Number(req.query.year) || null;
  const sort = ['title', 'author', 'year', 'available'].includes(req.query.sort)
    ? req.query.sort
    : 'title';

  const sql = `
    SELECT
      b.*,
      ${req.user ? 'EXISTS(SELECT 1 FROM favorites f WHERE f.user_id = ? AND f.book_id = b.id)' : '0'} AS is_favorite,
      ${
        req.user
          ? `EXISTS(
              SELECT 1 FROM reservations r
              WHERE r.user_id = ? AND r.book_id = b.id AND r.status IN ('reserved', 'issued')
            )`
          : '0'
      } AS has_active_reservation
    FROM books b
  `;

  const finalParams = req.user ? [req.user.id, req.user.id] : [];
  let rows = db.prepare(sql).all(...finalParams);

  const lower = (value) => String(value || '').toLocaleLowerCase('ru-RU');
  const qLower = lower(q);
  const genreLower = lower(genre);

  if (qLower) {
    rows = rows.filter((book) =>
      [book.title, book.author, book.genre, book.isbn, book.keywords, book.annotation].some((value) =>
        lower(value).includes(qLower)
      )
    );
  }

  if (genreLower) {
    rows = rows.filter((book) => lower(book.genre).includes(genreLower));
  }

  if (year) {
    rows = rows.filter((book) => Number(book.year) === year);
  }

  rows.sort((a, b) => {
    if (sort === 'author') return lower(a.author).localeCompare(lower(b.author), 'ru');
    if (sort === 'year') return (Number(b.year) || 0) - (Number(a.year) || 0) || lower(a.title).localeCompare(lower(b.title), 'ru');
    if (sort === 'available') return Number(b.copies_available) - Number(a.copies_available) || lower(a.title).localeCompare(lower(b.title), 'ru');
    return lower(a.title).localeCompare(lower(b.title), 'ru');
  });

  res.json(rows);
});

router.get('/genres/list', (req, res) => {
  const rows = db
    .prepare('SELECT DISTINCT genre FROM books WHERE genre IS NOT NULL AND genre <> "" ORDER BY genre')
    .all();
  res.json(rows.map((row) => row.genre));
});

router.get('/:id', (req, res) => {
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id);
  if (!book) {
    res.status(404).json({ error: 'Книга не найдена' });
    return;
  }
  res.json(book);
});

router.post('/', requireRole('librarian', 'admin'), (req, res) => {
  const { title, author, genre, year, isbn, annotation, keywords, cover_url, copies_total } = req.body;

  if (!title?.trim() || !author?.trim()) {
    res.status(400).json({ error: 'Укажите название и автора' });
    return;
  }

  const total = Math.max(1, Number(copies_total) || 1);

  const result = db
    .prepare(
      `INSERT INTO books (
        title, author, genre, year, isbn, annotation, keywords, cover_url,
        copies_total, copies_available
      )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      title.trim(),
      author.trim(),
      genre?.trim() || null,
      year ? Number(year) : null,
      isbn?.trim() || null,
      annotation?.trim() || null,
      keywords?.trim() || null,
      cover_url?.trim() || null,
      total,
      total
    );

  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(result.lastInsertRowid);
  logAction(req.user.id, 'book.create', `Добавлена книга "${book.title}"`);
  res.status(201).json(book);
});

router.put('/:id', requireRole('librarian', 'admin'), (req, res) => {
  const existing = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id);
  if (!existing) {
    res.status(404).json({ error: 'Книга не найдена' });
    return;
  }

  const { title, author, genre, year, isbn, annotation, keywords, cover_url, copies_total } = req.body;
  if (!title?.trim() || !author?.trim()) {
    res.status(400).json({ error: 'Укажите название и автора' });
    return;
  }

  const newTotal = Math.max(existing.copies_total - existing.copies_available, Number(copies_total) || 1);
  const onLoan = existing.copies_total - existing.copies_available;
  const newAvailable = Math.max(0, newTotal - onLoan);

  db.prepare(
    `UPDATE books
     SET title = ?, author = ?, genre = ?, year = ?, isbn = ?, annotation = ?, keywords = ?,
         cover_url = ?, copies_total = ?, copies_available = ?
     WHERE id = ?`
  ).run(
    title.trim(),
    author.trim(),
    genre?.trim() || null,
    year ? Number(year) : null,
    isbn?.trim() || null,
    annotation?.trim() || null,
    keywords?.trim() || null,
    cover_url?.trim() || null,
    newTotal,
    newAvailable,
    req.params.id
  );

  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id);
  logAction(req.user.id, 'book.update', `Изменена книга "${book.title}"`);
  res.json(book);
});

router.delete('/:id', requireRole('librarian', 'admin'), (req, res) => {
  const activeLoans = db
    .prepare('SELECT COUNT(*) AS n FROM loans WHERE book_id = ? AND return_date IS NULL')
    .get(req.params.id).n;
  const activeReservations = db
    .prepare(
      `SELECT COUNT(*) AS n
       FROM reservations
       WHERE book_id = ? AND status IN ('reserved', 'issued')`
    )
    .get(req.params.id).n;

  if (activeLoans > 0 || activeReservations > 0) {
    res.status(400).json({ error: 'Нельзя удалить книгу с активной бронью или выдачей' });
    return;
  }

  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id);
  const result = db.prepare('DELETE FROM books WHERE id = ?').run(req.params.id);
  if (result.changes === 0) {
    res.status(404).json({ error: 'Книга не найдена' });
    return;
  }
  logAction(req.user.id, 'book.delete', `Удалена книга "${book.title}"`);
  res.status(204).send();
});

module.exports = router;
