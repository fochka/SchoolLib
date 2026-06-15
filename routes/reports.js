const express = require('express');
const { db } = require('../db/database');
const { logAction, requireRole } = require('../utils/auth');

const router = express.Router();

router.use(requireRole('librarian', 'admin'));

function rowsToHtml(title, columns, rows) {
  const head = columns.map((col) => `<th>${col.label}</th>`).join('');
  const body = rows
    .map((row) => `<tr>${columns.map((col) => `<td>${row[col.key] ?? ''}</td>`).join('')}</tr>`)
    .join('');
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>body{font-family:Arial,sans-serif;padding:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px;text-align:left}h1{font-size:22px}</style>
</head>
<body>
  <h1>${title}</h1>
  <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
  <script>if (location.search.includes('print=1')) print()</script>
</body>
</html>`;
}

function sendReport(req, res, title, columns, rows) {
  logAction(req.user.id, 'report.view', title);
  if (req.query.format === 'pdf') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(title)}.html"`);
    res.send(rowsToHtml(`${title} (для печати в PDF)`, columns, rows));
    return;
  }
  if (req.query.format === 'xlsx') {
    // Лёгкий вариант без тяжёлых библиотек: Excel открывает HTML-таблицу как книгу.
    res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(title)}.xls"`);
    res.send(rowsToHtml(title, columns, rows));
    return;
  }
  res.json({ title, columns, rows });
}

router.get('/popular', (req, res) => {
  const from = req.query.from || '1970-01-01';
  const to = req.query.to || '2999-12-31';
  const rows = db
    .prepare(
      `SELECT b.title, b.author, COUNT(r.id) AS total
       FROM reservations r
       JOIN books b ON b.id = r.book_id
       WHERE date(r.created_at) BETWEEN date(?) AND date(?)
       GROUP BY b.id
       ORDER BY total DESC, b.title
       LIMIT 20`
    )
    .all(from, to);
  sendReport(
    req,
    res,
    'Популярные книги',
    [
      { key: 'title', label: 'Название' },
      { key: 'author', label: 'Автор' },
      { key: 'total', label: 'Бронирований' },
    ],
    rows
  );
});

router.get('/debtors', (req, res) => {
  const rows = db
    .prepare(
      `SELECT u.name, u.email, u.class_name, b.title, r.due_at
       FROM reservations r
       JOIN users u ON u.id = r.user_id
       JOIN books b ON b.id = r.book_id
       WHERE r.status = 'issued' AND datetime(r.due_at) < datetime('now')
       ORDER BY r.due_at`
    )
    .all();
  sendReport(
    req,
    res,
    'Отчёт по задолжникам',
    [
      { key: 'name', label: 'Читатель' },
      { key: 'email', label: 'Email' },
      { key: 'class_name', label: 'Класс' },
      { key: 'title', label: 'Книга' },
      { key: 'due_at', label: 'Срок возврата' },
    ],
    rows
  );
});

router.get('/movement', (req, res) => {
  const rows = db
    .prepare(
      `SELECT b.title, b.author, b.copies_total, b.copies_available,
              SUM(CASE WHEN r.status = 'reserved' THEN r.quantity ELSE 0 END) AS reserved,
              SUM(CASE WHEN r.status = 'issued' THEN r.quantity ELSE 0 END) AS issued
       FROM books b
       LEFT JOIN reservations r ON r.book_id = b.id
       GROUP BY b.id
       ORDER BY b.title`
    )
    .all();
  sendReport(
    req,
    res,
    'Ведомость движения книжного фонда',
    [
      { key: 'title', label: 'Название' },
      { key: 'author', label: 'Автор' },
      { key: 'copies_total', label: 'Всего' },
      { key: 'copies_available', label: 'Доступно' },
      { key: 'reserved', label: 'Забронировано' },
      { key: 'issued', label: 'Выдано' },
    ],
    rows
  );
});

router.get('/writeoff', (req, res) => {
  const rows = db
    .prepare(
      `SELECT title, author, year, isbn, 0 AS quantity, '' AS reason
       FROM books
       ORDER BY title`
    )
    .all();
  sendReport(
    req,
    res,
    'Акт списания литературы',
    [
      { key: 'title', label: 'Название' },
      { key: 'author', label: 'Автор' },
      { key: 'year', label: 'Год' },
      { key: 'isbn', label: 'ISBN' },
      { key: 'quantity', label: 'Списать' },
      { key: 'reason', label: 'Причина' },
    ],
    rows
  );
});

module.exports = router;
