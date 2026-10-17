// Local usage records arrive after a response, not once per streamed token.
const counter = value => Number.isSafeInteger(value) && value >= 0 ? value : null
const seconds = (start, end, max = 600) => Number.isFinite(start) && end > start
  && (end - start) >= 200 && (end - start) <= max * 1000 ? (end - start) / 1000 : null
function totals(value) {
  if (!value || counter(value.input_tokens) === null || counter(value.output_tokens) === null) return null
  return { input: value.input_tokens, output: value.output_tokens,
    cached: counter(value.cached_input_tokens) ?? 0, reasoning: counter(value.reasoning_output_tokens) ?? 0 }
}

export function reduceTokenSpeed(previous, entry) {
  const state = previous || { total: null, recordAt: null, requestAt: null, firstOutputAt: null, sample: null }
  const at = Date.parse(entry?.timestamp || '')
  if (!Number.isFinite(at)) return state
  const p = entry.payload || {}
  if (entry.type === 'event_msg' && p.type === 'task_started'
      || entry.type === 'response_item' && ['function_call_output', 'custom_tool_call_output'].includes(p.type)) {
    if (state.recordAt !== null && at < state.recordAt) return state
    return { ...state, requestAt: at, firstOutputAt: null }
  }
  if (entry.type === 'event_msg' && p.type === 'item_completed'
      && ['Reasoning', 'AgentMessage'].includes(p.item?.type)) {
    const started = p.started_at_ms, ended = p.completed_at_ms
    if (Number.isFinite(started) && Number.isFinite(ended) && state.requestAt !== null
        && started >= state.requestAt && started <= ended && ended <= at) {
      return { ...state, firstOutputAt: Math.min(state.firstOutputAt ?? started, started) }
    }
    return state
  }
  const modern = entry.type === 'token_usage_record'
  if (!modern && !(entry.type === 'event_msg' && p.type === 'token_count')) return state
  const total = totals(modern ? p.thread_token_usage?.total ?? p.thread_token_usage : p.info?.total_token_usage)
  if (!total || state.recordAt !== null && at <= state.recordAt) return state
  if (state.total && ['input', 'output', 'cached', 'reasoning'].every(k => total[k] === state.total[k])) return state
  const next = { ...state, total, recordAt: at, requestAt: at, firstOutputAt: null }
  if (state.total && ['input', 'output', 'cached', 'reasoning'].some(k => total[k] < state.total[k])) {
    return { ...next, sample: null }
  }
  const reported = totals(modern ? p.usage : p.info?.last_token_usage)
  const requestDuration = seconds(state.requestAt, at)
  const interval = seconds(state.recordAt, at, 120)
  const delta = state.total && { input: total.input - state.total.input, output: total.output - state.total.output,
    cached: total.cached - state.total.cached, reasoning: total.reasoning - state.total.reasoning }
  const usage = reported && requestDuration ? reported : delta
  const inputSeconds = reported && requestDuration ? requestDuration : interval
  if (!usage || !inputSeconds) return next
  // Only a matching per-request count can use the first assistant-item boundary.
  const outputSeconds = reported && requestDuration ? seconds(state.firstOutputAt, at) || requestDuration : interval
  if (!outputSeconds) return next
  return { ...next, sample: { measuredAt: at, inputTokens: usage.input, outputTokens: usage.output,
    cachedInputTokens: usage.cached, reasoningTokens: usage.reasoning,
    inputSeconds, outputSeconds, inputRate: usage.input / inputSeconds, outputRate: usage.output / outputSeconds,
    nonCachedInputRate: Math.max(0, usage.input - usage.cached) / inputSeconds,
    outputMethod: reported && requestDuration ? seconds(state.firstOutputAt, at) ? 'output-start' : 'request' : 'interval',
    source: modern ? 'token_usage_record' : 'token_count' } }
}

export function tokenSpeedSnapshot(state, now = Date.now(), { running = true } = {}) {
  const sample = state?.sample || null
  const ageMs = sample ? now - sample.measuredAt : null
  const status = !running ? 'offline' : !sample ? 'unavailable'
    : ageMs < 0 || ageMs > 45000 ? 'stale' : 'recent'
  return { ...sample, status, estimated: true, inputRate: status === 'recent' ? sample.inputRate : null,
    outputRate: status === 'recent' ? sample.outputRate : null,
    nonCachedInputRate: status === 'recent' ? sample.nonCachedInputRate : null }
}
