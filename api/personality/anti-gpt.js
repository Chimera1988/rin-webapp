const PREFIXES = [
  /^(Это действительно|Это очень|Это довольно)\s+(важно|интересно|трогательно|замечательно)[.!,:-]?\s*/i,
  /^(Ты прав|Ты совершенно прав)[.!,:-]?\s*/i,
  /^(Безусловно|Конечно же)[.!,:-]?\s*/i
];

export function polishRinReply(reply = '', decision = null) {
  let text = String(reply || '').trim();
  for (const pattern of PREFIXES) text = text.replace(pattern, '');

  text = text
    .replace(/\?{2,}/g, '?')
    .replace(/!{3,}/g, '!!')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Убираем типичную сервисную приписку, если пользователь её не просил.
  text = text.replace(/\s*(Если (?:хочешь|будет нужно),? (?:я могу|можем)[^.?!]*[.?!]?)$/i, '').trim();

  // В коротких режимах не даём ответу расползаться из-за лишнего заключения.
  if (decision?.targetLength === '1–2 предложения') {
    const parts = text.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g) || [text];
    if (parts.length > 3) text = parts.slice(0, 3).join('').trim();
  }

  return text || '…';
}
