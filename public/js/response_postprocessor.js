// Клиентская техническая очистка. Смысл, вопросы и советы не удаляются.
export function postProcessRinReply({ reply = '' } = {}) {
  return String(reply || '')
    .replace(/^```(?:text)?\s*/iu, '')
    .replace(/\s*```$/u, '')
    .replace(/\[(?:internal|system|debug)[^\]]*\]/giu, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
