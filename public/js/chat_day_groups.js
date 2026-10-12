// Client-local civil calendar dates. Messages remain ordered by (timestamp, id).
// Use calendar-day arithmetic rather than dividing milliseconds by 24h (DST-safe).
export function localDayKey(timestamp) {
  const date = new Date(Number(timestamp));
  if (!Number.isFinite(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

export function chatDayLabel(timestamp, now = Date.now()) {
  const date = new Date(Number(timestamp));
  const current = new Date(Number(now));
  if (!Number.isFinite(date.getTime()) || !Number.isFinite(current.getTime())) return '';
  const dateDay = Date.UTC(date.getFullYear(),date.getMonth(),date.getDate());
  const nowDay = Date.UTC(current.getFullYear(),current.getMonth(),current.getDate());
  const days = Math.round((nowDay-dateDay)/86_400_000);
  if (days === 0) return 'Сегодня';
  if (days === 1) return 'Вчера';
  if (days === 2) return 'Позавчера';
  return `${String(date.getDate()).padStart(2,'0')}.${String(date.getMonth()+1).padStart(2,'0')}.${date.getFullYear()}`;
}

// Pure, testable grouping of a mixed (text/sticker/voice) chronological history.
export function historyDayGroups(messages, now = Date.now()) {
  const groups=[];
  for(const message of messages || []) {
    if (!message || message.kind === 'silence') continue;
    const key=localDayKey(message.ts);
    if (!key) continue;
    const last=groups.at(-1);
    if (last?.key===key) last.messages.push(message);
    else groups.push({key,label:chatDayLabel(message.ts,now),messages:[message]});
  }
  return groups;
}
