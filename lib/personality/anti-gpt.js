// Техническая очистка без переписывания смысла ответа модели.
export function polishRinReply(reply = '') {
  const text = String(reply || '')
    .replace(/^```(?:text)?\s*/iu, '')
    .replace(/\s*```$/u, '')
    .replace(/\[(?:internal|system|debug)[^\]]*\]/giu, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\?{3,}/g, '??')
    .replace(/!{4,}/g, '!!!')
    .trim();

  return text || '…';
}
