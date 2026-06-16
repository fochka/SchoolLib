const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, '..', 'library.db');
const schemaPath = path.join(__dirname, 'schema.sql');

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(schemaPath, 'utf8');
db.exec(schema);

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
}

function hasColumn(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((item) => item.name === column);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(12).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');
  return `${salt}:${hash}`;
}

function runMigrations() {
  ensureColumn('books', 'genre', 'TEXT');
  ensureColumn('books', 'annotation', 'TEXT');
  ensureColumn('books', 'keywords', 'TEXT');
  ensureColumn('books', 'cover_url', 'TEXT');
  ensureColumn('users', 'email', 'TEXT');
  ensureColumn('users', 'password_hash', 'TEXT');
  ensureColumn('events', 'created_at', 'TEXT');
  db.prepare("UPDATE events SET created_at = COALESCE(created_at, datetime('now'))").run();
  ensureColumn('reservations', 'quantity', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn('reservations', 'created_at', 'TEXT');
  ensureColumn('reservations', 'due_at', 'TEXT');
  ensureColumn('reservations', 'canceled_at', 'TEXT');
  if (hasColumn('reservations', 'reserved_at')) {
    db.prepare("UPDATE reservations SET created_at = COALESCE(created_at, reserved_at, datetime('now'))").run();
  } else {
    db.prepare("UPDATE reservations SET created_at = COALESCE(created_at, datetime('now'))").run();
  }
  if (hasColumn('reservations', 'due_date')) {
    db.prepare('UPDATE reservations SET due_at = COALESCE(due_at, due_date)').run();
  }
  db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)').run();

  const reservationFks = db.prepare('PRAGMA foreign_key_list(reservations)').all();
  if (reservationFks.some((fk) => fk.table === 'users_old')) {
    db.pragma('foreign_keys = OFF');
    db.exec(`
      CREATE TABLE reservations_fixed (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        book_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'reserved',
        reserved_until TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        issued_at TEXT,
        due_at TEXT,
        returned_at TEXT,
        canceled_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE RESTRICT
      );

      INSERT INTO reservations_fixed (
        id, user_id, book_id, quantity, status, reserved_until, created_at,
        issued_at, due_at, returned_at, canceled_at
      )
      SELECT
        id, user_id, book_id, COALESCE(quantity, 1), status,
        COALESCE(reserved_until, datetime('now', '+3 days')),
        COALESCE(created_at, reserved_at, datetime('now')),
        issued_at,
        COALESCE(due_at, due_date),
        returned_at,
        canceled_at
      FROM reservations;

      DROP TABLE reservations;
      ALTER TABLE reservations_fixed RENAME TO reservations;
    `);
    db.pragma('foreign_keys = ON');
  }

  db.prepare('CREATE INDEX IF NOT EXISTS idx_reservations_user ON reservations(user_id, status)').run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_reservations_book ON reservations(book_id, status)').run();

  const favoriteFks = db.prepare('PRAGMA foreign_key_list(favorites)').all();
  if (favoriteFks.some((fk) => fk.table === 'users_old')) {
    db.pragma('foreign_keys = OFF');
    db.exec(`
      CREATE TABLE favorites_fixed (
        user_id INTEGER NOT NULL,
        book_id INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, book_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
      );

      INSERT OR IGNORE INTO favorites_fixed (user_id, book_id, created_at)
      SELECT user_id, book_id, COALESCE(created_at, datetime('now'))
      FROM favorites;

      DROP TABLE favorites;
      ALTER TABLE favorites_fixed RENAME TO favorites;
    `);
    db.pragma('foreign_keys = ON');
  }
}

function addLog(userId, action, details) {
  db.prepare('INSERT INTO system_logs (user_id, action, details) VALUES (?, ?, ?)').run(
    userId || null,
    action,
    details || null
  );
}

function expireOldReservations() {
  const expired = db
    .prepare(
      `SELECT id, book_id, quantity
       FROM reservations
       WHERE status = 'reserved' AND datetime(reserved_until) < datetime('now')`
    )
    .all();

  if (!expired.length) return;

  db.transaction((rows) => {
    const expireReservation = db.prepare(
      `UPDATE reservations
       SET status = 'expired', canceled_at = datetime('now')
       WHERE id = ?`
    );
    const restoreBook = db.prepare(
      'UPDATE books SET copies_available = copies_available + ? WHERE id = ?'
    );

    for (const row of rows) {
      expireReservation.run(row.id);
      restoreBook.run(row.quantity || 1, row.book_id);
      addLog(null, 'reservation.expired', `Бронь #${row.id} снята автоматически`);
    }
  })(expired);
}

runMigrations();
expireOldReservations();

function seedIfEmpty() {
  const bookCount = db.prepare('SELECT COUNT(*) AS n FROM books').get().n;
  const insertBook = db.prepare(`
    INSERT INTO books (
      title, author, genre, year, isbn, annotation, keywords, cover_url,
      copies_total, copies_available
    )
    VALUES (
      @title, @author, @genre, @year, @isbn, @annotation, @keywords, @cover_url,
      @copies_total, @copies_available
    )
  `);

  if (bookCount === 0) {
    const books = [
      {
        title: 'Мастер и Маргарита',
        author: 'М. А. Булгаков',
        genre: 'Роман',
        year: 1967,
        isbn: '978-5-17-000001-1',
        annotation: 'Классический роман о добре, зле, любви и свободе.',
        keywords: 'классика мистика сатира',
        cover_url: null,
        copies_total: 3,
        copies_available: 3,
      },
      {
        title: 'Преступление и наказание',
        author: 'Ф. М. Достоевский',
        genre: 'Роман',
        year: 1866,
        isbn: '978-5-17-000002-2',
        annotation: 'Роман о преступлении, совести и нравственном выборе.',
        keywords: 'классика психология школа',
        cover_url: null,
        copies_total: 2,
        copies_available: 2,
      },
      {
        title: 'Евгений Онегин',
        author: 'А. С. Пушкин',
        genre: 'Поэма',
        year: 1833,
        isbn: '978-5-17-000003-3',
        annotation: 'Роман в стихах о любви, взрослении и обществе.',
        keywords: 'стихи классика литература',
        cover_url: null,
        copies_total: 4,
        copies_available: 4,
      },
      {
        title: 'Алгебра. 8 класс',
        author: 'Ю. Н. Макарычев',
        genre: 'Учебник',
        year: 2022,
        isbn: '978-5-09-000004-4',
        annotation: 'Учебник алгебры для массового бронирования на класс.',
        keywords: 'математика учебник 8 класс',
        cover_url: null,
        copies_total: 25,
        copies_available: 25,
      },
    ];

    const insertMany = db.transaction((rows) => {
      for (const row of rows) insertBook.run(row);
    });
    insertMany(books);

    const insertReader = db.prepare(`
      INSERT INTO readers (name, class_name) VALUES (@name, @class_name)
    `);
    insertReader.run({ name: 'Иванов Петр', class_name: '9А' });
    insertReader.run({ name: 'Смирнова Анна', class_name: '10Б' });
  }

  const userCount = db.prepare('SELECT COUNT(*) AS n FROM users WHERE email IS NOT NULL').get().n;
  if (userCount === 0) {
    db.prepare('DELETE FROM users WHERE email IS NULL').run();
    const insertUser = db.prepare(`
      INSERT INTO users (name, email, password_hash, role, class_name)
      VALUES (@name, @email, @password_hash, @role, @class_name)
    `);
    const password_hash = hashPassword('123456');
    const users = [
      { name: 'Ученик Иванов', email: 'student@school.local', role: 'student', class_name: '9А' },
      { name: 'Учитель Петрова', email: 'teacher@school.local', role: 'teacher', class_name: '8А' },
      { name: 'Библиотекарь', email: 'librarian@school.local', role: 'librarian', class_name: null },
      { name: 'Администратор', email: 'admin@school.local', role: 'admin', class_name: null },
    ];
    for (const user of users) insertUser.run({ ...user, password_hash });
    addLog(null, 'system.seed', 'Созданы тестовые пользователи. Пароль для всех: 123456');
  }
}

seedIfEmpty();

module.exports = { db, hashPassword, expireOldReservations, addLog };
