import { RIN_RELEASE_ID } from './release.js';
import { authenticatedHeaders, fetchWithTimeout, getStoredPin, removeStoredPin } from './http_client.js';

function redirectToLogin(reason = '') {
  const query = reason ? `?reason=${encodeURIComponent(reason)}` : '';
  window.location.replace(`/login.html${query}`);
}

document.getElementById('backButton')?.addEventListener('click', () => {
  if (window.history.length > 1) window.history.back();
});

async function validateSession(pin) {
  try {
    const response = await fetchWithTimeout('/api/login', {
      method: 'POST',
      headers: authenticatedHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ pin }),
      cache: 'no-store'
    }, 10_000);
    return { ok: response.ok, status: response.status };
  } catch (error) {
    return { ok: false, status: 0, code: error?.name === 'AbortError' ? 'timeout' : 'network' };
  }
}

const CHAT_ERROR_TEXTS = new Set([
  'Ответ оборвался на стороне модели. Повтори отправку.',
  'Сервис не успел ответить. Повтори отправку.',
  'Сервис временно перегружен. Сообщение можно повторить.',
  'Связь с сервисом временно недоступна. Сообщение можно повторить.',
  'Сервис отклонил запрос. Сообщение не добавлено в контекст; его можно повторить.',
  'Не удалось безопасно сформировать ответ. Сообщение можно повторить.',
  'Не удалось получить ответ. Сообщение не включено в следующий контекст; его можно повторить.'
]);

function installChatErrorNoticeBridge() {
  const chat = document.getElementById('chat');
  if (!chat) return null;

  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();

  const moveErrorIntoFailedMessage = row => {
    if (!(row instanceof HTMLElement) || !row.classList.contains('her')) return false;
    const text = normalize(row.querySelector('.bubble-text')?.textContent);
    if (!CHAT_ERROR_TEXTS.has(text)) return false;

    const failedRows = [...chat.querySelectorAll('.row.me[data-status="failed"]')];
    const failedRow = failedRows.at(-1);
    const bubble = failedRow?.querySelector('.bubble');
    if (!bubble) return false;

    let notice = bubble.querySelector('.message-error-note');
    if (!notice) {
      notice = document.createElement('div');
      notice.className = 'message-error-note';
      notice.style.marginTop = '8px';
      notice.style.fontSize = '12px';
      notice.style.lineHeight = '1.35';
      notice.style.opacity = '0.72';
      notice.style.maxWidth = '34ch';
      bubble.appendChild(notice);
    }
    notice.textContent = text;
    row.remove();
    return true;
  };

  // Handles an error rendered by chat.js after a failed turn. Instead of adding
  // another fake "Rin" message, keep one retryable diagnostic on the failed user
  // bubble. Repeated failures therefore update one notice rather than spamming chat.
  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.matches?.('.row.her')) moveErrorIntoFailedMessage(node);
        for (const row of node.querySelectorAll?.('.row.her') || []) moveErrorIntoFailedMessage(row);
      }
    }
  });
  observer.observe(chat, { childList: true, subtree: false });

  for (const row of [...chat.querySelectorAll('.row.her')]) moveErrorIntoFailedMessage(row);

  chat.addEventListener('click', event => {
    const retry = event.target instanceof Element ? event.target.closest('.message-retry') : null;
    if (!retry) return;
    retry.closest('.row.me')?.querySelector('.message-error-note')?.remove();
  }, true);

  return observer;
}

const pin = getStoredPin();
if (!pin) {
  redirectToLogin('missing_pin');
} else {
  const auth = await validateSession(pin);
  if (!auth.ok) {
    if (auth.status === 401) {
      removeStoredPin();
      redirectToLogin('invalid_pin');
    } else {
      redirectToLogin('auth_unavailable');
    }
  } else {
    installChatErrorNoticeBridge();
    await import(`/js/persona_ui.js?v=${encodeURIComponent(RIN_RELEASE_ID)}`);
    const chatModule = await import(`/chat.js?v=${encodeURIComponent(RIN_RELEASE_ID)}`);
    await chatModule.RIN_CHAT_READY;
    document.documentElement.classList.add('auth-ready');
  }
}
