const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const state = {
  user: null,
  books: [],
  highlightedBookId: new URLSearchParams(window.location.search).get('book'),
  qrScanner: null,
  publicOrigin: window.location.origin,
};
const roleNames = {
  student: 'Ученик',
  teacher: 'Учитель',
  librarian: 'Библиотекарь',
  admin: 'Администратор',
};

function canUseTeacherTools() {
  return ['teacher', 'librarian', 'admin'].includes(state.user?.role);
}

function canUseStaffTools() {
  return ['librarian', 'admin'].includes(state.user?.role);
}

function isAdmin() {
  return state.user?.role === 'admin';
}

function showMessage(text, type = 'success') {
  const el = $('#message');
  el.textContent = text;
  el.className = `message message--${type}`;
  el.hidden = false;
  setTimeout(() => (el.hidden = true), 3500);
}

function bindPasswordToggles() {
  $$('[data-password-toggle]').forEach((button) => {
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

async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error('API не найден. Запустите сайт через npm start и откройте http://localhost:3000.');
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

function fmtDate(value) {
  if (!value) return '—';
  return String(value).slice(0, 10).split('-').reverse().join('.');
}

function bookLink(bookId) {
  return `${state.publicOrigin}/cabinet.html?book=${encodeURIComponent(bookId)}`;
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
  setActiveTab('catalog');
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

function statusText(status) {
  return {
    reserved: 'Забронировано',
    issued: 'Выдано',
    returned: 'Возвращено',
    canceled: 'Отменено',
    expired: 'Истекло',
  }[status] || status;
}

function setActiveTab(tab) {
  $$('.tabs__btn').forEach((btn) => btn.classList.toggle('tabs__btn--active', btn.dataset.tab === tab));
  $$('.panel').forEach((panel) => {
    const active = panel.id === `panel-${tab}`;
    panel.hidden = !active;
    panel.classList.toggle('panel--active', active);
  });
}

function updateRoleUI() {
  $('.teacher-only').hidden = !canUseTeacherTools();
  $('.librarian-only').hidden = !canUseStaffTools();
  $('.admin-only').hidden = !isAdmin();

  $('#user-box').innerHTML = `
    <div class="user-box__name">${esc(state.user.name)}</div>
    <div class="user-box__role">${roleNames[state.user.role] || state.user.role}</div>
    <a class="btn btn--small" href="/">Каталог для гостей</a>
    <button class="btn btn--small" id="logout-btn">Выйти</button>
  `;
  $('#logout-btn').addEventListener('click', logout);
}

function fillProfileForm() {
  const form = $('#profile-form');
  if (!form || !state.user) return;

  form.name.value = state.user.name || '';
  form.email.value = state.user.email || '';
  form.role_name.value = roleNames[state.user.role] || state.user.role;
  form.class_name.value = state.user.class_name || '';
}

function bookCard(book) {
  const canReserve = book.copies_available > 0 && !book.has_active_reservation;
  const highlighted = String(book.id) === String(state.highlightedBookId) ? ' book-card--highlight' : '';
  const actions = [
    book.is_favorite
      ? `<button class="btn btn--small" data-unfavorite="${book.id}">Убрать из избранного</button>`
      : `<button class="btn btn--small" data-favorite="${book.id}">В избранное</button>`,
    `<button class="btn btn--small" data-qr-book="${book.id}">QR-код</button>`,
  ];

  if (canReserve) {
    actions.push(`<button class="btn btn--primary btn--small" data-reserve="${book.id}">Забронировать</button>`);
  }
  if (canUseStaffTools()) {
    actions.push(`<button class="btn btn--small" data-edit="${book.id}">Редактировать</button>`);
    actions.push(`<button class="btn btn--ghost btn--small" data-delete-book="${book.id}">Удалить</button>`);
  }

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
        <div class="book-actions">${actions.join('')}</div>
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

  state.books = await api(`/api/books?${params}`);
  $('#books-list').innerHTML = state.books.length
    ? state.books.map(bookCard).join('')
    : '<div class="card empty">Книги не найдены</div>';
  fillBookSelects();
}

function fillBookSelects() {
  const options =
    '<option value="">— выберите книгу —</option>' +
    state.books
      .filter((book) => book.copies_available > 0)
      .map((book) => `<option value="${book.id}">${esc(book.title)} — свободно ${book.copies_available}</option>`)
      .join('');
  $('#mass-book-select').innerHTML = options;
}

async function loadAccount() {
  const [reservations, favorites] = await Promise.all([api('/api/reservations/mine'), api('/api/favorites')]);
  fillProfileForm();
  const active = reservations.filter((r) => ['reserved', 'issued'].includes(r.status));
  const history = reservations.filter((r) => !['reserved', 'issued'].includes(r.status));
  const debt = active.filter((r) => r.status === 'issued' && r.due_at && new Date(r.due_at) < new Date());

  $('#my-active').innerHTML =
    (debt.length ? `<p class="message message--error">Текущая задолженность: ${debt.length}</p>` : '') +
    renderReservations(active, { mine: true });
  $('#my-history').innerHTML = renderReservations(history, { mine: true });
  $('#favorites-list').innerHTML = favorites.length
    ? favorites.map((b) => `<p><b>${esc(b.title)}</b><br><span class="muted">${esc(b.author)}</span></p>`).join('')
    : '<p class="muted">Избранных книг пока нет.</p>';
}

function renderReservations(rows, options = {}) {
  if (!rows.length) return '<p class="muted">Нет записей.</p>';
  return `
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>Книга</th><th>Пользователь</th><th>Статус</th><th>Срок</th><th></th></tr></thead>
        <tbody>
          ${rows
            .map((r) => {
              const buttons = [];
              if (options.mine && r.status === 'reserved') {
                buttons.push(`<button class="btn btn--ghost btn--small" data-cancel="${r.id}">Отменить</button>`);
              }
              if (options.staff && r.status === 'reserved') {
                buttons.push(`<button class="btn btn--primary btn--small" data-issue="${r.id}">Выдать</button>`);
                buttons.push(`<button class="btn btn--ghost btn--small" data-cancel="${r.id}">Отменить</button>`);
              }
              if (options.staff && r.status === 'issued') {
                buttons.push(`<button class="btn btn--primary btn--small" data-return="${r.id}">Вернуть</button>`);
              }
              return `<tr>
                <td>${esc(r.book_title)} ${r.quantity > 1 ? `(${r.quantity} шт.)` : ''}</td>
                <td>${esc(r.user_name || state.user.name)}<br><span class="muted">${esc(r.user_class || '')}</span></td>
                <td>${statusText(r.status)}</td>
                <td>${r.status === 'reserved' ? fmtDate(r.reserved_until) : fmtDate(r.due_at || r.returned_at)}</td>
                <td>${buttons.join('')}</td>
              </tr>`;
            })
            .join('')}
        </tbody>
      </table>
    </div>`;
}

function fillBookForm(book) {
  if (!book) return;
  for (const [key, value] of Object.entries(book)) {
    const field = $(`#book-form [name="${key}"]`);
    if (field) field.value = value ?? '';
  }
  setActiveTab('staff');
  $('#book-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderStaffBooks() {
  const target = $('#staff-books-list');
  if (!target) return;
  if (!state.books.length) {
    target.innerHTML = '<p class="muted">Книги не найдены.</p>';
    return;
  }

  target.innerHTML = `
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Название</th>
            <th>Автор</th>
            <th>Жанр</th>
            <th>Экземпляры</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${state.books
            .map(
              (book) => `<tr>
                <td>${esc(book.title)}</td>
                <td>${esc(book.author)}</td>
                <td>${esc(book.genre || '—')}</td>
                <td>${book.copies_available} / ${book.copies_total}</td>
                <td>
                  <button class="btn btn--small" type="button" data-staff-edit-book="${book.id}">Редактировать</button>
                  <button class="btn btn--ghost btn--small" type="button" data-staff-delete-book="${book.id}">Удалить</button>
                </td>
              </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>`;
}

async function loadStaff() {
  if (!canUseStaffTools()) return;
  renderStaffBooks();
  const [reservations, events] = await Promise.all([api('/api/reservations'), api('/api/events')]);
  $('#all-reservations').innerHTML = renderReservations(reservations, { staff: true });
  $('#events-list').innerHTML = events.length
    ? events.map((e) => `<p><b>${esc(e.title)}</b> ${fmtDate(e.event_date)}<br><span class="muted">${esc(e.description || '')}</span></p>`).join('')
    : '<p class="muted">Событий пока нет.</p>';
}

async function loadAdmin() {
  if (!isAdmin()) return;
  const [users, logs] = await Promise.all([api('/api/admin/users'), api('/api/admin/logs')]);
  $('#users-list').innerHTML = renderUsers(users);
  $('#logs-list').innerHTML = logs.length
    ? `<div class="table-wrap"><table class="table"><thead><tr><th>Дата</th><th>Пользователь</th><th>Действие</th><th>Детали</th></tr></thead><tbody>${logs
        .map((l) => `<tr><td>${fmtDate(l.created_at)}</td><td>${esc(l.user_name || 'система')}</td><td>${esc(l.action)}</td><td>${esc(l.details || '')}</td></tr>`)
        .join('')}</tbody></table></div>`
    : '<p class="muted">Логов пока нет.</p>';
}

function renderUsers(users) {
  return `
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>Имя</th><th>Email</th><th>Роль</th><th>Класс</th><th>Статус</th><th></th></tr></thead>
        <tbody>
          ${users
            .map(
              (u) => `<tr>
                <td>${esc(u.name)}</td>
                <td>${esc(u.email)}</td>
                <td>
                  <select data-role-user="${u.id}">
                    ${Object.entries(roleNames)
                      .map(([value, label]) => `<option value="${value}" ${u.role === value ? 'selected' : ''}>${label}</option>`)
                      .join('')}
                  </select>
                </td>
                <td>${esc(u.class_name || '')}</td>
                <td>${u.is_blocked ? 'Заблокирован' : 'Активен'}</td>
                <td><button class="btn btn--small" data-block-user="${u.id}" data-blocked="${u.is_blocked}">${
                u.is_blocked ? 'Разблокировать' : 'Заблокировать'
              }</button></td>
              </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>`;
}

async function loadReport(name) {
  const report = await api(`/api/reports/${name}`);
  $('#report-result').innerHTML = `
    <h3>${esc(report.title)}</h3>
    <p>
      <a class="btn btn--small" href="/api/reports/${name}?format=pdf" target="_blank">PDF через печать</a>
      <a class="btn btn--small" href="/api/reports/${name}?format=xlsx">Excel</a>
    </p>
    ${renderSimpleTable(report.columns, report.rows)}`;
}

function renderSimpleTable(columns, rows) {
  if (!rows.length) return '<p class="muted">Нет данных.</p>';
  return `<div class="table-wrap"><table class="table"><thead><tr>${columns
    .map((c) => `<th>${esc(c.label)}</th>`)
    .join('')}</tr></thead><tbody>${rows
    .map((row) => `<tr>${columns.map((c) => `<td>${esc(row[c.key] ?? '')}</td>`).join('')}</tr>`)
    .join('')}</tbody></table></div>`;
}

function resetBookForm() {
  $('#book-form').reset();
  $('#book-form [name="id"]').value = '';
  $('#book-form [name="copies_total"]').value = 1;
}

async function logout() {
  await api('/api/auth/logout', { method: 'POST' });
  window.location.href = '/';
}

function bindEvents() {
  bindPasswordToggles();

  $$('.tabs__btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      setActiveTab(btn.dataset.tab);
      if (btn.dataset.tab === 'account') await loadAccount();
      if (btn.dataset.tab === 'staff') await loadStaff();
      if (btn.dataset.tab === 'admin') await loadAdmin();
    });
  });

  ['#books-search', '#genre-filter', '#year-filter', '#sort-filter'].forEach((sel) => {
    $(sel).addEventListener('input', () => loadBooks().catch((e) => showMessage(e.message, 'error')));
    $(sel).addEventListener('change', () => loadBooks().catch((e) => showMessage(e.message, 'error')));
  });

  $('#books-list').addEventListener('click', async (e) => {
    const id = e.target.dataset.reserve || e.target.dataset.favorite || e.target.dataset.unfavorite || e.target.dataset.edit || e.target.dataset.deleteBook || e.target.dataset.qrBook;
    if (!id) return;

    try {
      if (e.target.dataset.qrBook) {
        const book = state.books.find((item) => String(item.id) === String(id));
        if (book) showBookQr(book);
        return;
      }
      if (e.target.dataset.reserve) await api('/api/reservations', { method: 'POST', body: JSON.stringify({ book_id: id }) });
      if (e.target.dataset.favorite) await api(`/api/favorites/${id}`, { method: 'POST' });
      if (e.target.dataset.unfavorite) await api(`/api/favorites/${id}`, { method: 'DELETE' });
      if (e.target.dataset.edit) {
        const book = state.books.find((b) => String(b.id) === String(id));
        fillBookForm(book);
      }
      if (e.target.dataset.deleteBook && confirm('Удалить книгу?')) await api(`/api/books/${id}`, { method: 'DELETE' });
      await refreshRoleData();
      showMessage('Действие выполнено');
    } catch (err) {
      showMessage(err.message, 'error');
    }
  });

  $('#staff-books-list').addEventListener('click', async (e) => {
    const editId = e.target.dataset.staffEditBook;
    const deleteId = e.target.dataset.staffDeleteBook;
    if (!editId && !deleteId) return;

    try {
      if (editId) {
        const book = state.books.find((item) => String(item.id) === String(editId));
        fillBookForm(book);
        return;
      }

      if (deleteId && confirm('Удалить эту книгу из фонда?')) {
        await api(`/api/books/${deleteId}`, { method: 'DELETE' });
        await refreshRoleData();
        showMessage('Книга удалена');
      }
    } catch (err) {
      showMessage(err.message, 'error');
    }
  });

  $('#book-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const id = fd.get('id');
    const payload = Object.fromEntries(fd.entries());
    delete payload.id;
    try {
      await api(id ? `/api/books/${id}` : '/api/books', {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      });
      resetBookForm();
      await refreshRoleData();
      showMessage('Книга сохранена');
    } catch (err) {
      showMessage(err.message, 'error');
    }
  });
  $('#book-form-reset').addEventListener('click', resetBookForm);

  $('#qr-scan-btn').addEventListener('click', () => startQrScanner().catch((e) => showMessage(e.message, 'error')));

  $('#profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const data = await api('/api/auth/me', {
        method: 'PATCH',
        body: JSON.stringify({
          name: fd.get('name'),
          class_name: fd.get('class_name'),
        }),
      });
      state.user = data.user;
      updateRoleUI();
      fillProfileForm();
      showMessage('Профиль сохранён');
    } catch (err) {
      showMessage(err.message, 'error');
    }
  });

  $('#password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const newPassword = fd.get('new_password');
    const repeatPassword = fd.get('repeat_password');

    if (newPassword !== repeatPassword) {
      showMessage('Новые пароли не совпадают', 'error');
      return;
    }

    try {
      await api('/api/auth/me/password', {
        method: 'PATCH',
        body: JSON.stringify({
          current_password: fd.get('current_password'),
          new_password: newPassword,
        }),
      });
      e.target.reset();
      showMessage('Пароль изменён');
    } catch (err) {
      showMessage(err.message, 'error');
    }
  });

  document.body.addEventListener('click', async (e) => {
    const cancelId = e.target.dataset.cancel;
    const issueId = e.target.dataset.issue;
    const returnId = e.target.dataset.return;
    if (!cancelId && !issueId && !returnId) return;
    try {
      if (cancelId) await api(`/api/reservations/${cancelId}/cancel`, { method: 'PATCH' });
      if (issueId) await api(`/api/reservations/${issueId}/issue`, { method: 'PATCH' });
      if (returnId) await api(`/api/reservations/${returnId}/return`, { method: 'PATCH' });
      await refreshRoleData();
      showMessage('Действие выполнено');
    } catch (err) {
      showMessage(err.message, 'error');
    }
  });

  $('#mass-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/api/reservations/mass', {
        method: 'POST',
        body: JSON.stringify({ book_id: fd.get('book_id'), class_name: fd.get('class_name'), count: fd.get('count') }),
      });
      e.target.reset();
      await refreshRoleData();
      showMessage('Массовое бронирование создано');
    } catch (err) {
      showMessage(err.message, 'error');
    }
  });

  $$('.report-buttons [data-report]').forEach((btn) => {
    btn.addEventListener('click', () => loadReport(btn.dataset.report).catch((e) => showMessage(e.message, 'error')));
  });

  $('#event-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/api/events', { method: 'POST', body: JSON.stringify(Object.fromEntries(fd.entries())) });
      e.target.reset();
      await loadStaff();
      showMessage('Событие добавлено');
    } catch (err) {
      showMessage(err.message, 'error');
    }
  });

  $('#user-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/api/admin/users', { method: 'POST', body: JSON.stringify(Object.fromEntries(fd.entries())) });
      e.target.reset();
      await loadAdmin();
      showMessage('Пользователь создан');
    } catch (err) {
      showMessage(err.message, 'error');
    }
  });

  $('#users-list').addEventListener('change', async (e) => {
    const id = e.target.dataset.roleUser;
    if (!id) return;
    await api(`/api/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify({ role: e.target.value }) });
    await loadAdmin();
  });

  $('#users-list').addEventListener('click', async (e) => {
    const id = e.target.dataset.blockUser;
    if (!id) return;
    const isBlocked = e.target.dataset.blocked !== '1';
    await api(`/api/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify({ is_blocked: isBlocked }) });
    await loadAdmin();
  });
}

async function refreshRoleData() {
  await loadBooks();
  await loadAccount();
  if (canUseStaffTools()) await loadStaff();
  if (isAdmin()) await loadAdmin();
}

async function loadConfig() {
  const config = await api('/api/config').catch(() => null);
  if (config?.publicOrigin) state.publicOrigin = config.publicOrigin;
}

async function init() {
  await loadConfig();
  const data = await api('/api/auth/me');
  if (!data.user) {
    window.location.href = '/?auth=required';
    return;
  }
  state.user = data.user;
  updateRoleUI();
  fillProfileForm();
  bindEvents();
  await refreshRoleData();
  if (state.highlightedBookId) await focusBook(state.highlightedBookId);
}

init().catch((err) => showMessage(err.message, 'error'));
