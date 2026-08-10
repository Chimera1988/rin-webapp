import { RIN_RELEASE_ID } from './release.js';
import { fetchWithTimeout, storePin } from './http_client.js';
const form = document.getElementById('loginForm');
const input = document.getElementById('pinInput');
const button = form?.querySelector('button[type="submit"]');
const errorBox = document.getElementById('loginError');

function showError(message) {
  if (!errorBox) return;
  errorBox.textContent = message;
  errorBox.hidden = !message;
}


const reason = new URLSearchParams(window.location.search).get('reason');
if (reason === 'invalid_pin') showError('Сохранённый PIN больше не подходит. Введи актуальный PIN.');
if (reason === 'auth_unavailable') showError('Сервис проверки входа временно недоступен. PIN сохранён; повтори вход позже.');

form?.addEventListener('submit', async event => {
  event.preventDefault();
  const pin = String(input?.value || '').trim();
  if (!pin) return;

  showError('');
  if (button) button.disabled = true;
  if (input) input.disabled = true;

  try {
    const response = await fetchWithTimeout('/api/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Rin-Pin': pin
      },
      body: JSON.stringify({}),
      cache: 'no-store'
    }, 10_000);

    if (!response.ok) {
      showError(response.status === 401
        ? 'Неверный PIN.'
        : 'Сервис входа временно недоступен.');
      return;
    }

    if (!storePin(pin)) {
      showError('Не удалось сохранить PIN в локальном хранилище браузера.');
      return;
    }
    window.location.replace(`/index.html?v=${encodeURIComponent(RIN_RELEASE_ID)}`);
  } catch {
    showError('Не удалось проверить PIN. Проверь подключение и повтори попытку.');
  } finally {
    if (button) button.disabled = false;
    if (input) input.disabled = false;
    input?.focus();
  }
});
