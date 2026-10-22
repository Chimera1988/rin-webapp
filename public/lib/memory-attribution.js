// v2.6.24: correct a specific misattributed memory event without changing its identity.
// The archived dialogue establishes that the reading plan belonged to Rin,
// but provides no evidence that she actually started or finished the book.
export const DALI_READING_EVENT_KEY = 'k-2347l';
export const DALI_READING_WRONG_TEXT = 'пользователь выразил намерение читать "Дневник одного гения" Сальвадора Дали';
export const DALI_READING_CORRECTED_TEXT = 'Рин сказала, что думает начать читать «Дневник одного гения» Сальвадора Дали; начало чтения не подтверждено.';

export function isMisattributedDaliReading(event) {
  return Boolean(event && typeof event === 'object' && !Array.isArray(event)
    && (event.id === DALI_READING_EVENT_KEY || event.key === DALI_READING_EVENT_KEY)
    && event.text === DALI_READING_WRONG_TEXT);
}

export function correctKnownMemoryAttribution(event) {
  if (!isMisattributedDaliReading(event)) return event;
  return { ...event, text: DALI_READING_CORRECTED_TEXT };
}

export function correctKnownMemoryEvents(events) {
  return Array.isArray(events) ? events.map(correctKnownMemoryAttribution) : [];
}
