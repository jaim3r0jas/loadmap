/**
 * The two ways to reach a model, with nothing but `fetch`: a server that speaks OpenAI's chat completions (OpenAI,
 * DeepSeek, OpenRouter, Groq, Ollama, LM Studio and most others) and Anthropic's messages. Each streams the answer's
 * text and says what it used. A key goes in a header to its own provider and nowhere else, and an error never says it.
 */

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  /** What stays the same from one request to the next (the reference): cached where the provider can. */
  system: string
  /** What changes: the files, the facts, the request. */
  context?: string
  messages: readonly ChatMessage[]
  maxTokens?: number
  signal?: AbortSignal
}

export interface Usage {
  input: number
  output: number
  /** Of the input: read from the provider's cache, and written to it. */
  cached?: number
  written?: number
}

export type ChatEvent = { type: 'text'; text: string } | { type: 'usage'; usage: Usage }

/** A model to ask: one request at a time, the answer streamed. */
export interface ModelProvider {
  /** "openai-compatible" or "anthropic", and the model's name, for the trace. */
  kind: string
  model: string
  chat(r: ChatRequest): AsyncIterable<ChatEvent>
}

export class ModelError extends Error {
  /** HTTP status, when the provider answered. */
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
  }
}

export interface OpenAICompatibleOptions {
  /** The API's root, before `/chat/completions`: "https://api.deepseek.com/v1", "http://localhost:11434/v1". */
  url: string
  key?: string
  model: string
  /** More headers: OpenRouter's `HTTP-Referer` and `X-Title`. */
  headers?: Readonly<Record<string, string>>
  fetch?: typeof fetch
}

export interface AnthropicOptions {
  key: string
  model: string
  /** https://api.anthropic.com by default. */
  url?: string
  fetch?: typeof fetch
}

/** Lines of a server-sent event stream: each `data:` payload. */
async function* events(res: Response, signal?: AbortSignal): AsyncGenerator<string> {
  const body = res.body
  if (!body) return
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      if (signal?.aborted) return
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      for (let nl = buffer.indexOf('\n'); nl >= 0; nl = buffer.indexOf('\n')) {
        const line = buffer.slice(0, nl).replace(/\r$/, '')
        buffer = buffer.slice(nl + 1)
        if (line.startsWith('data:')) yield line.slice(5).trimStart()
      }
    }
    if (buffer.startsWith('data:')) yield buffer.slice(5).trimStart()
  } finally {
    reader.releaseLock()
  }
}

/** The provider's own words for a refusal, without anything of the request. */
async function failure(name: string, res: Response): Promise<ModelError> {
  let detail = ''
  try {
    const j = (await res.json()) as { error?: { message?: unknown } | string; message?: unknown }
    const m = typeof j.error === 'string' ? j.error : (j.error?.message ?? j.message)
    if (typeof m === 'string') detail = `: ${m.slice(0, 300)}`
  } catch {}
  const why =
    res.status === 401 || res.status === 403
      ? 'the key was refused'
      : res.status === 429
        ? 'too many requests, or the account is out of credit'
        : `it answered ${res.status}`
  return new ModelError(`${name}: ${why}${detail}`, res.status)
}

async function post(name: string, call: typeof fetch, url: string, init: RequestInit): Promise<Response> {
  let res: Response
  try {
    res = await call(url, init)
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    throw new ModelError(`${name} cannot be reached: ${(err as Error).message}`)
  }
  if (!res.ok) throw await failure(name, res)
  return res
}

/** A server that speaks OpenAI's chat completions, streamed. */
export function openaiCompatible(o: OpenAICompatibleOptions): ModelProvider {
  const call = o.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init))
  const root = o.url.replace(/\/+$/, '')
  const host = (() => {
    try {
      return new URL(root).host
    } catch {
      return root
    }
  })()
  return {
    kind: 'openai-compatible',
    model: o.model,
    async *chat(r) {
      const res = await post(host, call, `${root}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(o.key && { authorization: `Bearer ${o.key}` }),
          ...o.headers,
        },
        body: JSON.stringify({
          model: o.model,
          stream: true,
          stream_options: { include_usage: true },
          ...(r.maxTokens && { max_tokens: r.maxTokens }),
          // the reference first and alone: providers that cache a prefix by themselves (OpenAI, DeepSeek) find it
          messages: [
            { role: 'system', content: r.system },
            ...(r.context ? [{ role: 'system', content: r.context }] : []),
            ...r.messages,
          ],
        }),
        signal: r.signal,
      })
      for await (const data of events(res, r.signal)) {
        if (data === '[DONE]') break
        let j: {
          choices?: { delta?: { content?: string | null } }[]
          usage?: {
            prompt_tokens?: number
            completion_tokens?: number
            prompt_cache_hit_tokens?: number
            prompt_tokens_details?: { cached_tokens?: number }
          } | null
        }
        try {
          j = JSON.parse(data)
        } catch {
          continue
        }
        const text = j.choices?.[0]?.delta?.content
        if (text) yield { type: 'text', text }
        if (j.usage) {
          const cached = j.usage.prompt_tokens_details?.cached_tokens ?? j.usage.prompt_cache_hit_tokens
          yield {
            type: 'usage',
            usage: {
              input: j.usage.prompt_tokens ?? 0,
              output: j.usage.completion_tokens ?? 0,
              ...(cached != null && { cached }),
            },
          }
        }
      }
    },
  }
}

/**
 * Anthropic's messages API, streamed, the reference cached. From a browser it needs the header that says the page
 * calls it directly: the key is the reader's own, typed into this page.
 */
export function anthropic(o: AnthropicOptions): ModelProvider {
  const call = o.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init))
  const root = (o.url ?? 'https://api.anthropic.com').replace(/\/+$/, '')
  return {
    kind: 'anthropic',
    model: o.model,
    async *chat(r) {
      const res = await post('Anthropic', call, `${root}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': o.key,
          'anthropic-version': '2026-10-21',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: o.model,
          max_tokens: r.maxTokens ?? 16_000,
          stream: true,
          system: [
            { type: 'text', text: r.system, cache_control: { type: 'ephemeral' } },
            ...(r.context ? [{ type: 'text', text: r.context }] : []),
          ],
          messages: r.messages,
        }),
        signal: r.signal,
      })
      const usage: Usage = { input: 0, output: 0 }
      for await (const data of events(res, r.signal)) {
        let j: {
          type?: string
          delta?: { type?: string; text?: string; stop_reason?: string }
          message?: { usage?: Record<string, number> }
          usage?: Record<string, number>
          error?: { message?: string }
        }
        try {
          j = JSON.parse(data)
        } catch {
          continue
        }
        if (j.type === 'content_block_delta' && j.delta?.type === 'text_delta' && j.delta.text)
          yield { type: 'text', text: j.delta.text }
        const u = j.type === 'message_start' ? j.message?.usage : j.type === 'message_delta' ? j.usage : undefined
        if (u) {
          if (u.input_tokens != null)
            usage.input = u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
          if (u.output_tokens != null) usage.output = u.output_tokens
          if (u.cache_read_input_tokens != null) usage.cached = u.cache_read_input_tokens
          if (u.cache_creation_input_tokens != null) usage.written = u.cache_creation_input_tokens
        }
        if (j.type === 'message_delta' && j.delta?.stop_reason === 'refusal')
          throw new ModelError('Anthropic: the model declined this request')
        if (j.type === 'error') throw new ModelError(`Anthropic: ${j.error?.message ?? 'an error in the stream'}`)
      }
      yield { type: 'usage', usage }
    },
  }
}

/** Answers written in advance, one per request, for tests and the eval's replays: no network. */
export function recorded(answers: readonly string[], model = 'recorded'): ModelProvider & { requests: ChatRequest[] } {
  const requests: ChatRequest[] = []
  return {
    kind: 'recorded',
    model,
    requests,
    async *chat(r) {
      requests.push(r)
      const answer = answers[requests.length - 1]
      if (answer == null) throw new ModelError('the recording has no more answers')
      for (const piece of answer.match(/[\s\S]{1,40}/g) ?? []) yield { type: 'text', text: piece }
      yield { type: 'usage', usage: { input: r.system.length / 4, output: answer.length / 4 } }
    },
  }
}
