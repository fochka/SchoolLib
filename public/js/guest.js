const $ = (sel) => document.querySelector(sel);

const state = {
  books: [],
  highlightedBookId: new URLSearchParams(window.location.search).get('book'),
  qrScanner: null,
  publicOrigin: window.location.origin,
};

function showMessage(text, type = 'success') {
  const el = $('#message');
  el.textContent = text;
  el.className = `message message--${type}`;
  el.hidden = false;
  setTimeout(() => (el.hidden = true), 3500);
}

function bindPasswordToggles() {
  document.querySelectorAll('[data-password-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const input = button.closest('.password-field')?.querySelector('input');
      if (!input) return;

      const shouldShow = input.type === 'password';
      input.type = shouldShow ? 'text' : 'password';

      const label = shouldShow ? 'Скрыть пароль' : 'Показать пароль';
      button.setAttribute('aria-label', label);
      button.title = label;
    });
  });
}

function redirectAfterMessage(url) {
  setTimeout(() => {
    window.location.href = url;
  }, 900);
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error('API не найден. Запустите сайт через npm start и откройте http://localhost:3000, а не Live Server или файл index.html.');
    }
    throw new Error(data.error || `Ошибка ${res.status}`);
  }
  return data;
}

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function bookLink(bookId) {
  return `${state.publicOrigin}/?book=${encodeURIComponent(bookId)}`;
}

function qrImageUrl(bookId) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(bookLink(bookId))}`;
}

function ensureQrModal() {
  if ($('#qr-modal')) return;
  document.body.insertAdjacentHTML(
    'beforeend',
    `<div id="qr-modal" class="modal" hidden>
      <div class="modal__backdrop" data-close-modal></div>
      <div class="modal__card">
        <button class="modal__close" type="button" data-close-modal>×</button>
        <div id="qr-modal-content"></div>
      </div>
    </div>`
  );
  $('#qr-modal').addEventListener('click', (e) => {
    if (e.target.dataset.closeModal !== undefined) closeQrModal();
  });
}

async function closeQrModal() {
  if (state.qrScanner) {
    await state.qrScanner.stop().catch(() => {});
    state.qrScanner.clear();
    state.qrScanner = null;
  }
  $('#qr-modal').hidden = true;
}

function openQrModal(html) {
  ensureQrModal();
  $('#qr-modal-content').innerHTML = html;
  $('#qr-modal').hidden = false;
}

function showBookQr(book) {
  openQrModal(`
    <h2>QR-код книги</h2>
    <p class="muted">${esc(book.title)} · ${esc(book.author)}</p>
    <img class="qr-image" src="${qrImageUrl(book.id)}" alt="QR-код книги ${esc(book.title)}" />
    <p><input class="input qr-link" value="${bookLink(book.id)}" readonly /></p>
  `);
}

function bookIdFromQr(text) {
  try {
    const url = new URL(text);
    return url.searchParams.get('book');
  } catch (err) {
    return String(text || '').match(/^\d+$/) ? text : null;
  }
}

async function focusBook(bookId) {
  if (!bookId) return;
  state.highlightedBookId = String(bookId);
  $('#books-search').value = '';
  $('#genre-filter').value = '';
  $('#year-filter').value = '';
  await loadBooks();

  const el = document.querySelector(`[data-book-id="${CSS.escape(String(bookId))}"]`);
  if (!el) {
    showMessage('Книга из QR-кода не найдена', 'error');
    return;
  }
  el.classList.add('book-card--highlight');
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function handleQrText(text) {
  const bookId = bookIdFromQr(text);
  await closeQrModal();
  if (!bookId) {
    showMessage('QR-код не похож на ссылку книги', 'error');
    return;
  }
  const url = new URL(window.location.href);
  url.searchParams.set('book', bookId);
  window.history.replaceState({}, '', url);
  await focusBook(bookId);
  showMessage('Книга найдена по QR-коду');
}

async function startQrScanner() {
  openQrModal(`
    <h2>Сканирование QR-кода</h2>
    <p class="muted">Разрешите доступ к камере и наведите её на QR-код книги.</p>
    <div id="qr-reader" class="qr-reader"></div>
    <div class="qr-manual">
      <input id="qr-manual-input" class="input" placeholder="Или вставьте ссылку из QR-кода" />
      <button class="btn btn--primary" type="button" id="qr-manual-btn">Открыть</button>
    </div>
  `);
  $('#qr-manual-btn').addEventListener('click', () => handleQrText($('#qr-manual-input').value));

  if (!window.Html5Qrcode) {
    showMessage('Сканер не загрузился. Можно вставить ссылку из QR-кода вручную.', 'error');
    return;
  }

  state.qrScanner = new Html5Qrcode('qr-reader');
  await state.qrScanner.start(
    { facingMode: 'environment' },
    { fps: 10, qrbox: { width: 240, height: 240 } },
    (decodedText) => handleQrText(decodedText)
  ).catch(() => {
    showMessage('Не удалось открыть камеру. Проверьте разрешение браузера.', 'error');
  });
}

function bookCard(book) {
  const highlighted = String(book.id) === String(state.highlightedBookId) ? ' book-card--highlight' : '';
  return `
    <article class="book-card${highlighted}" data-book-id="${book.id}">
      <img class="book-card__cover" src="${esc(book.cover_url || 'https://dummyimage.com/200x300/e5e7eb/374151&text=Book')}" alt="" />
      <div class="book-card__body">
        <h3>${esc(book.title)}</h3>
        <p class="muted">${esc(book.author)} · ${esc(book.genre || 'без жанра')} · ${book.year || 'год не указан'}</p>
        <p>${esc(book.annotation || 'Аннотация не заполнена.')}</p>
        <p class="muted">ISBN: ${esc(book.isbn || '—')} · Ключевые слова: ${esc(book.keywords || '—')}</p>
        <p><span class="${book.copies_available > 0 ? 'badge' : 'badge badge--warn'}">
          Доступно: ${book.copies_available} / ${book.copies_total}
        </span></p>
        <div class="book-actions">
          <button class="btn btn--small" type="button" data-qr-book="${book.id}">QR-код</button>
        </div>
      </div>
    </article>`;
}

async function loadBooks() {
  const params = new URLSearchParams();
  const q = $('#books-search').value.trim();
  const genre = $('#genre-filter').value.trim();
  const year = $('#year-filter').value.trim();
  if (q) params.set('q', q);
  if (genre) params.set('genre', genre);
  if (year) params.set('year', year);
  params.set('sort', $('#sort-filter').value);

  const books = await api(`/api/books?${params}`);
  state.books = books;
  $('#books-list').innerHTML = books.length
    ? books.map(bookCard).join('')
    : '<div class="card empty">Книги не найдены</div>';
}

async function renderUserBox() {
  const data = await api('/api/auth/me');
  if (!data.user) return;

  $('#auth-card').hidden = true;
  $('#guest-user-box').innerHTML = `
    <div class="user-box__name">${esc(data.user.name)}</div>
    <div class="user-box__role">${esc(data.user.role_name)}</div>
    <a class="btn btn--small" href="/cabinet.html">В личный кабинет</a>
  `;
}

async function loadConfig() {
  const config = await api('/api/config').catch(() => null);
  if (config?.publicOrigin) state.publicOrigin = config.publicOrigin;
}

function bindEvents() {
  bindPasswordToggles();

  ['#books-search', '#genre-filter', '#year-filter', '#sort-filter'].forEach((sel) => {
    $(sel).addEventListener('input', () => loadBooks().catch((e) => showMessage(e.message, 'error')));
    $(sel).addEventListener('change', () => loadBooks().catch((e) => showMessage(e.message, 'error')));
  });

  $('#qr-scan-btn').addEventListener('click', () => startQrScanner().catch((e) => showMessage(e.message, 'error')));

  $('#books-list').addEventListener('click', (e) => {
    const id = e.target.dataset.qrBook;
    if (!id) return;
    const book = state.books.find((item) => String(item.id) === String(id));
    if (book) showBookQr(book);
  });

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: fd.get('email'), password: fd.get('password') }),
      });
      showMessage('Вход выполнен успешно');
      redirectAfterMessage('/cabinet.html');
    } catch (err) {
      showMessage(err.message, 'error');
    }
  });

  $('#register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name: fd.get('name'),
          email: fd.get('email'),
          class_name: fd.get('class_name'),
          password: fd.get('password'),
        }),
      });
      showMessage('Регистрация прошла успешно');
      redirectAfterMessage('/cabinet.html');
    } catch (err) {
      showMessage(err.message, 'error');
    }
  });
}

async function init() {
  bindEvents();
  await loadConfig();
  await renderUserBox();
  await loadBooks();
  if (state.highlightedBookId) await focusBook(state.highlightedBookId);
}

init().catch((err) => showMessage(err.message, 'error'));
