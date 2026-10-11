/* RIN-DBG-DELTA/1: reversible compression for diagnostics, not encryption.
 * Fields omitted in ~ records inherit their values from the previous record of the SAME type.
 * Every exported selection begins with its own baseline for each record type.
 */
export const DEBUG_FORMAT_ID = 'RIN-DBG-DELTA/1';
export const DEBUG_LEGEND = '# S=turn state committed; R=reply complete; P=proactive complete; ~=changes only (unchanged fields inherited from previous same-type record); !=other event';
const KINDS = Object.freeze({
  'turn state committed': 'S',
  'reply complete': 'R',
  'proactive complete': 'P'
});
const NAMES = Object.freeze(Object.fromEntries(Object.entries(KINDS).map(([name, code]) => [code, name])));
const FIELD = /^[A-Za-z][A-Za-z0-9]*$/;
const PREFIX = /^\[(\d{2}:\d{2}:\d{2})\] /;

function parseEvent(line) {
  const text = String(line);
  for (const [name, kind] of Object.entries(KINDS)) {
    const prefix = `${name}: `;
    if (!text.startsWith(prefix)) continue;
    const payload = text.slice(prefix.length);
    const pieces = payload.split(/; (?=[A-Za-z][A-Za-z0-9]*=)/g);
    const fields = [];
    for (const piece of pieces) {
      const pos = piece.indexOf('=');
      if (pos < 1 || !FIELD.test(piece.slice(0, pos))) return null;
      fields.push({key:piece.slice(0, pos),value:piece.slice(pos + 1)});
    }
    if (!fields.length || fields.map(f=>`${f.key}=${f.value}`).join('; ') !== payload) return null;
    return { kind, fields };
  }
  return null;
}

function sameSchema(current, prior) {
  return current.length === prior.length && current.every((entry, i) => entry.key === prior[i].key);
}

/** Format complete timestamped original events into a self-contained, reversible text log. */
export function formatCompactDebug(entries = []) {
  const out = [DEBUG_FORMAT_ID, DEBUG_LEGEND];
  const prev = new Map();
  for (const item of entries) {
    const time = String(item.time || '00:00:00');
    const line = String(item.line ?? '');
    const parsed = parseEvent(line);
    if (!parsed) {
      // JSON encoding also preserves unusual whitespace/newlines and delimiters.
      out.push(`[${time}] ! ${JSON.stringify(line)}`);
      continue;
    }
    const before = prev.get(parsed.kind);
    const uniqueKeys = new Set(parsed.fields.map(field => field.key)).size === parsed.fields.length;
    const delta = Boolean(before && uniqueKeys && sameSchema(parsed.fields, before));
    const fields = delta
      ? parsed.fields.filter((field, index) => field.value !== before[index].value)
      : parsed.fields;
    const body = fields.map(({key,value}) => `${key}=${value}`).join('; ');
    // JSON encodes the body to preserve arbitrary punctuation and newlines exactly.
    out.push(`[${time}] ${parsed.kind}${delta ? '~' : ''} ${JSON.stringify(body)}`);
    prev.set(parsed.kind, parsed.fields);
  }
  return out.join('\n');
}

/** Restore the original full lines (including timestamps) from a compact export. */
export function decodeCompactDebug(source = '') {
  const lines = String(source).split('\n');
  if (lines[0] !== DEBUG_FORMAT_ID || lines[1] !== DEBUG_LEGEND) throw new Error('Unsupported Rin debug log format');
  const restored = [];
  const prev = new Map();
  for (const line of lines.slice(2)) {
    const header = PREFIX.exec(line);
    if (!header) throw new Error('Invalid debug log timestamp');
    const time = header[1];
    const rest = line.slice(header[0].length);
    const event = /^([SRP])(~?) ("(?:[^"\\]|\\.)*")$/.exec(rest);
    if (rest.startsWith('! ')) {
      restored.push(`[${time}] ${JSON.parse(rest.slice(2))}`);
      continue;
    }
    if (!event) throw new Error('Invalid compact debug event');
    const kind = event[1];
    const isDelta = event[2] === '~';
    const data = JSON.parse(event[3]);
    if (typeof data !== 'string') throw new Error('Invalid debug event payload');
    const parsed = parseEvent(`${NAMES[kind]}: ${data}`);
    if (data && !parsed) throw new Error('Invalid debug event fields');
    const changes = parsed?.fields || [];
    let fields;
    if (!isDelta) {
      fields = changes;
    } else {
      const baseline = prev.get(kind);
      if (!baseline) throw new Error('Debug delta without baseline');
      fields = baseline.map(f=>({...f}));
      for (const change of changes) {
        const index = fields.findIndex(f=>f.key === change.key);
        if (index < 0) throw new Error('Debug delta has unknown field');
        fields[index].value = change.value;
      }
    }
    prev.set(kind, fields);
    restored.push(`[${time}] ${NAMES[kind]}: ${fields.map(f=>`${f.key}=${f.value}`).join('; ')}`);
  }
  return restored.map(line => line.replace(/^\[(\d{2}:\d{2}:\d{2})\] ([SRP]): /, (_all, stamp, kind) => `[${stamp}] ${NAMES[kind]}: `)).join('\n');
}

/** Raw records are always retained so full diagnostics are available verbatim. */
export function createDebugLogBuffer({limit = 1000} = {}) {
  const entries = [];
  const size = Math.max(1, Math.floor(Number(limit) || 1000));
  return {
    push(line, time) {
      entries.push({line:String(line),time:String(time)});
      if (entries.length > size) entries.splice(0,entries.length - size);
    },
    clear() { entries.length=0; },
    compact({last = entries.length} = {}) { return formatCompactDebug(entries.slice(-Math.max(1,Number(last)||1))); },
    full() { return entries.map(({time,line}) => `[${time}] ${line}`).join('\n'); },
    count() { return entries.length; }
  };
}
