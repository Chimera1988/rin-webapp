/*
 * Клиентская техническая нормализация ответа.
 *
 * Смысл, стиль, длина и вопросы уже контролируются на сервере
 * Personality Core + anti-gpt. Браузер не переписывает реплику
 * второй раз, чтобы лог сервера совпадал с тем, что видит пользователь.
 */

function normalizeWhitespace(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function postProcessRinReply({ reply = '' } = {}) {
  const normalized = normalizeWhitespace(reply)
    .replace(/\?{2,}/g, '?')
    .replace(/!{3,}/g, '!!')
    .replace(/[\s,;:—-]+$/u, '')
    .trim();

  return normalized || normalizeWhitespace(reply);
}
