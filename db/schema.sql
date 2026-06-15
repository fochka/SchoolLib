CREATE TABLE IF NOT EXISTS books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  genre TEXT,
  year INTEGER,
  isbn TEXT,
  annotation TEXT,
  keywords TEXT,
  cover_url TEXT,
  copies_total INTEGER NOT NULL DEFAULT 1 CHECK (copies_total >= 0),
  copies_available INTEGER NOT NULL DEFAULT 1 CHECK (copies_available >= 0)
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student',
  class_name TEXT,
  is_blocked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS readers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  class_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS loans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL,
  reader_id INTEGER NOT NULL,
  loan_date TEXT NOT NULL DEFAULT (date('now')),
  return_date TEXT,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE RESTRICT,
  FOREIGN KEY (reader_id) REFERENCES readers(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS reservations (
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

CREATE TABLE IF NOT EXISTS favorites (
  user_id INTEGER NOT NULL,
  book_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, book_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  event_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS system_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_loans_active ON loans(book_id, return_date);
CREATE INDEX IF NOT EXISTS idx_books_title ON books(title);
CREATE INDEX IF NOT EXISTS idx_books_search ON books(title, author, genre, year);
CREATE INDEX IF NOT EXISTS idx_reservations_user ON reservations(user_id, status);
CREATE INDEX IF NOT EXISTS idx_reservations_book ON reservations(book_id, status);
CREATE INDEX IF NOT EXISTS idx_logs_created ON system_logs(created_at);
