// Deterministic day/date references. Never derive tomorrow from the current dayType.
// The input date is already Rin-local (Europe/Moscow in the current schedule).
const WEEKDAYS = Object.freeze(['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота']);
const RELATIVE = Object.freeze(['сегодня', 'завтра', 'послезавтра']);

function dateKeyFromEnvironment(env = null) {
  const match = /^(\d{4}-\d{2}-\d{2})\s+([01]\d|2[0-3]):([0-5]\d)/u.exec(String(env?.rinHuman || ''));
  if (!match) return null;
  const date = new Date(`${match[1]}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === match[1] ? match[1] : null;
}

export function rinCalendarForPrompt({ environment = null, weeklyRhythm = null, currentWorkMode = null } = {}) {
  const today = dateKeyFromEnvironment(environment);
  if (!today || !weeklyRhythm || typeof weeklyRhythm !== 'object') return null;
  const first = new Date(`${today}T00:00:00.000Z`);
  const configuredWorkDays = Array.isArray(weeklyRhythm.work_days) ? weeklyRhythm.work_days : [1, 2, 3, 4, 5];
  const workDays = new Set(configuredWorkDays.filter(v => Number.isInteger(v) && v >= 0 && v <= 6));
  const profiles = { weekday: weeklyRhythm.weekday || {}, saturday: weeklyRhythm.saturday || {}, sunday: weeklyRhythm.sunday || {} };
  const days = [];
  for (let offset = 0; offset < 8; offset += 1) {
    const date = new Date(first.getTime() + offset * 86_400_000);
    const weekdayIndex = date.getUTCDay();
    const dateKey = date.toISOString().slice(0, 10);
    const dayType = weekdayIndex === 0 ? 'sunday' : weekdayIndex === 6 ? 'saturday' : 'weekday';
    const workDefault = profiles[dayType].work_default;
    const scheduledWork = workDays.has(weekdayIndex) && workDefault !== false;
    days.push({
      relative: RELATIVE[offset] || null,
      dateKey,
      weekday: WEEKDAYS[weekdayIndex],
      dayType,
      scheduledWork,
      // Current state may differ from the scheduled default; do not project it onto tomorrow.
      workMode: offset === 0 ? currentWorkMode : null
    });
  }
  return { timezone: String(environment.rinTz || 'Europe/Moscow'), days };
}

export function formatRinCalendarGrounding(calendar = null) {
  if (!calendar?.days?.length) return '';
  const lines = calendar.days.map((day, index) => {
    const work = index === 0 && day.workMode
      ? `текущий режим=${day.workMode}; расписание=${day.scheduledWork ? 'обычно рабочий' : 'обычно выходной'}`
      : `по обычному недельному графику ${day.scheduledWork ? 'рабочий день' : 'выходной'}`;
    return `${day.relative || 'день недели'}: ${day.dateKey}, ${day.weekday} (${work})`;
  });
  return `КАЛЕНДАРЬ РИН (${calendar.timezone}):\n${lines.join('\n')}.\nЕсли спрашивают «завтра» или «послезавтра», отвечай именно о соответствующей строке, а не о текущем dayType/workMode. Это обычный недельный график, а не утверждение о конкретных исключениях и договорённостях. Явная поправка пользователя не должна исчезать в следующем ответе. Не смешивай день устройства пользователя с локальным днём Рин.`;
}
