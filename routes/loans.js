const express = require('express');
const { db } = require('../db/database');
const { requireRole } = require('../utils/auth');

const router = express.Router();

const listQuery = `
  SELECT
    l.id,
    l.loan_date,
    l.return_date,
    b.id AS book_id,
    b.title AS book_title,
    b.author AS book_author,
    r.id AS reader_id,
    r.name AS reader_name,
    r.class_name AS reader_class
  FROM loans l
  JOIN books b ON b.id = l.book_id
  JOIN readers r ON r.id = l.reader_id
`;

router.get('/', requireRole('librarian', 'admin'), (req, res) => {
  const activeOnly = req.query.active === '1';

  const sql = activeOnly
    ? `${listQuery} WHERE l.return_date IS NULL ORDER BY l.loan_date DESC`
    : `${listQuery} ORDER BY l.loan_date DESC`;

  res.json(db.prepare(sql).all());
});

router.post('/', requireRole('librarian', 'admin'), (req, res) => {
  const bookId = Number(req.body.book_id);
  const readerId = Number(req.body.reader_id);

  if (!bookId || !readerId) {
    res.status(400).json({ error: 'Выберите книгу и читателя' });
    return;
  }

  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId);
  const reader = db.prepare('SELECT * FROM readers WHERE id = ?').get(readerId);

  if (!book) {
    res.status(404).json({ error: 'Книга не найдена' });
    return;
  }
  if (!reader) {
    res.status(404).json({ error: 'Читатель не найден' });
    return;
  }
  if (book.copies_available < 1) {
    res.status(400).json({ error: 'Нет свободных экземпляров этой книги' });
    return;
  }

  const issue = db.transaction(() => {
    const result = db
      .prepare('INSERT INTO loans (book_id, reader_id) VALUES (?, ?)')
      .run(bookId, readerId);

    db.prepare('UPDATE books SET copies_available = copies_available - 1 WHERE id = ?').run(bookId);

    return result.lastInsertRowid;
  });

  const loanId = issue();
  const loan = db.prepare(`${listQuery} WHERE l.id = ?`).get(loanId);
  res.status(201).json(loan);
});

router.patch('/:id/return', requireRole('librarian', 'admin'), (req, res) => {
  const loan = db.prepare('SELECT * FROM loans WHERE id = ?').get(req.params.id);

  if (!loan) {
    res.status(404).json({ error: 'Выдача не найдена' });
    return;
  }
  if (loan.return_date) {
    res.status(400).json({ error: 'Книга уже возвращена' });
    return;
  }

  db.transaction(() => {
    db.prepare(`UPDATE loans SET return_date = date('now') WHERE id = ?`).run(req.params.id);
    db.prepare('UPDATE books SET copies_available = copies_available + 1 WHERE id = ?').run(loan.book_id);
  })();

  const updated = db.prepare(`${listQuery} WHERE l.id = ?`).get(req.params.id);
  res.json(updated);
});

module.exports = router;
