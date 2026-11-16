// Experiment: preserve Rin's existing contract while passing dialogue as real API roles.
const shorten = (s, max) => {
  const value = String(s ?? '').trim();
  if (value.length <= max) return value;
  const tail = Math.min(Math.floor(max * 0.35), 600);
  return `${value.slice(0, max - tail - 1)}…${value.slice(-tail)}`;
};

export function roleDialogue(history = [], requestId = '', maxTurns = 24, maxChars = 18000) {
  const rows = [];
  for (const event of Array.isArray(history) ? history : []) {
    if (!['user', 'assistant'].includes(event?.role)) continue;
    if (event.role === 'user' && requestId && String(event?.requestId || '') === String(requestId)) continue;
    const value = String(event?.content || '').trim();
    if (!value) continue;
    const role = event.role;
    const key = String(event?.turnId || event?.requestId || event?.id || '');
    const prev = rows.at(-1);
    if (key && prev?.role === role && prev?.key === key) {
      prev.content += `\n${shorten(value, 2200)}`;
    } else {
      rows.push({ role, key, content: shorten(value, 2200) });
    }
  }
  let kept = rows.slice(-Math.max(1, maxTurns));
  while (kept.length > 1 && kept.reduce((n, t) => n + t.content.length, 0) > maxChars) kept.shift();
  return kept.map(({role, content}) => ({ role, content }));
}

export function buildResponsesRequest({ model, prompt, history = [], requestId = '', userTurn = '', trigger = null,
  temperature = null, reasoning_effort = null, max_tokens = 1200, extraInput = [] } = {}) {
  const schema = prompt?.responseFormat?.json_schema;
  if (!model || !schema?.name || !schema?.schema) throw new Error('Rin Responses schema/model missing');
  const input = [
    { role: 'developer', content: String(prompt?.stableSystem || prompt?.system || '') },
    { role: 'developer', content: String(prompt?.dynamicSystem || '') },
    ...roleDialogue(history, requestId)
  ];
  if (!trigger && String(userTurn || '').trim()) input.push({ role: 'user', content: String(userTurn) });
  if (Array.isArray(extraInput)) input.push(...extraInput);
  const body = {
    model,
    input,
    text: { format: { type: 'json_schema', name: schema.name, strict: schema.strict ?? true, schema: schema.schema } },
    max_output_tokens: Math.max(250, Math.trunc(Number(max_tokens) || 1200)),
    store: false
  };
  if (reasoning_effort) body.reasoning = { effort: reasoning_effort };
  if (temperature != null && (!/^gpt-6(?:[.-]|$)/iu.test(model) || !reasoning_effort || reasoning_effort === 'none')) body.temperature = temperature;
  return body;
}

export function readResponsesResult(data, fallbackModel = '') {
  if (!data || typeof data !== 'object') throw new Error('Invalid Responses result');
  const text = typeof data.output_text === 'string' ? data.output_text
    : (Array.isArray(data.output) ? data.output : []).flatMap(item =>
      item?.type === 'message' ? (Array.isArray(item.content) ? item.content : []) : []
    ).filter(item => item?.type === 'output_text').map(item => item.text || '').join('\n');
  const use = data.usage || {};
  return {
    content: text.trim(),
    finishReason: data.status === 'incomplete' || data.incomplete_details?.reason === 'max_output_tokens' ? 'length' : (data.status === 'completed' ? 'stop' : String(data.status || 'unknown')),
    usage: {
      prompt_tokens: Number(use.input_tokens) || 0,
      completion_tokens: Number(use.output_tokens) || 0,
      total_tokens: Number(use.total_tokens) || 0,
      prompt_tokens_details: { cached_tokens: Number(use.input_tokens_details?.cached_tokens) || 0 },
      completion_tokens_details: { reasoning_tokens: Number(use.output_tokens_details?.reasoning_tokens) || 0 }
    },
    model: data.model || fallbackModel,
    requestAttempts: 1
  };
}
