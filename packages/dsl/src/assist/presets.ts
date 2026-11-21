import { anthropic, type ModelProvider, openaiCompatible } from './models'

/**
 * The providers a host offers by name: where each one answers, which kind of API it speaks, the environment variable
 * that holds its key for the cli, and a model when one is a sensible start. A page that calls them from a browser lists
 * their origins in its Content-Security-Policy (`PROVIDER_ORIGINS`).
 */
export interface ProviderPreset {
  id: string
  name: string
  kind: 'openai-compatible' | 'anthropic'
  url: string
  /** Where the cli reads the key. A local server needs none. */
  keyEnv?: string
  /** A model to start with, when the provider has one cheap enough to try. */
  model?: string
  local?: boolean
}

export const PROVIDERS: readonly ProviderPreset[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    kind: 'anthropic',
    url: 'https://api.anthropic.com',
    keyEnv: 'ANTHROPIC_API_KEY',
    model: 'claude-haiku-5-5',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    kind: 'openai-compatible',
    url: 'https://api.deepseek.com',
    keyEnv: 'DEEPSEEK_API_KEY',
    model: 'deepseek-flash',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    kind: 'openai-compatible',
    url: 'https://api.openai.com/v1',
    keyEnv: 'OPENAI_API_KEY',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    kind: 'openai-compatible',
    url: 'https://openrouter.ai/api/v1',
    keyEnv: 'OPENROUTER_API_KEY',
  },
  {
    id: 'groq',
    name: 'Groq',
    kind: 'openai-compatible',
    url: 'https://api.groq.com/openai/v1',
    keyEnv: 'GROQ_API_KEY',
  },
  {
    id: 'mistral',
    name: 'Mistral',
    kind: 'openai-compatible',
    url: 'https://api.mistral.ai/v1',
    keyEnv: 'MISTRAL_API_KEY',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    kind: 'openai-compatible',
    url: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyEnv: 'GEMINI_API_KEY',
  },
  { id: 'ollama', name: 'Ollama', kind: 'openai-compatible', url: 'http://localhost:11434/v1', local: true },
  { id: 'lmstudio', name: 'LM Studio', kind: 'openai-compatible', url: 'http://localhost:1234/v1', local: true },
]

/** The origins of the hosted providers: what a page's `connect-src` must allow for them. */
export const PROVIDER_ORIGINS: readonly string[] = PROVIDERS.filter((p) => !p.local).map((p) => new URL(p.url).origin)

/** A provider by its preset, with the reader's key and model. */
export function providerFor(
  preset: ProviderPreset,
  o: { key?: string; model?: string; url?: string; fetch?: typeof fetch },
): ModelProvider {
  const model = o.model ?? preset.model
  if (!model) throw new Error(`${preset.name} needs a model's name`)
  if (preset.kind === 'anthropic') {
    if (!o.key) throw new Error(`${preset.name} needs a key`)
    return anthropic({ key: o.key, model, ...(o.url && { url: o.url }), ...(o.fetch && { fetch: o.fetch }) })
  }
  if (!preset.local && !o.key) throw new Error(`${preset.name} needs a key`)
  return openaiCompatible({
    url: o.url ?? preset.url,
    model,
    ...(o.key && { key: o.key }),
    ...(o.fetch && { fetch: o.fetch }),
    ...(preset.id === 'openrouter' && { headers: { 'X-Title': 'loadmap' } }),
  })
}

/**
 * The provider the environment names, for the cli: `LOADMAP_AI_PROVIDER` (a preset's id, anthropic by default),
 * `LOADMAP_AI_MODEL`, the key from `LOADMAP_AI_KEY` or the preset's own variable, and `LOADMAP_AI_URL` for another
 * server that speaks OpenAI's API. An error says what is missing, never a key.
 */
export function providerFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  o: { provider?: string; model?: string; fetch?: typeof fetch } = {},
): ModelProvider {
  const id = o.provider ?? env.LOADMAP_AI_PROVIDER ?? (env.LOADMAP_AI_URL ? 'custom' : 'anthropic')
  const url = env.LOADMAP_AI_URL?.trim() || undefined
  const preset: ProviderPreset | undefined =
    PROVIDERS.find((p) => p.id === id) ??
    (id === 'custom' && url ? { id, name: url, kind: 'openai-compatible', url, local: true } : undefined)
  if (!preset)
    throw new Error(`no provider "${id}": one of ${PROVIDERS.map((p) => p.id).join(', ')}, or LOADMAP_AI_URL`)
  const key = env.LOADMAP_AI_KEY?.trim() || (preset.keyEnv ? env[preset.keyEnv]?.trim() : undefined) || undefined
  const model = o.model ?? (env.LOADMAP_AI_MODEL?.trim() || undefined)
  try {
    return providerFor(preset, { key, model, url, fetch: o.fetch })
  } catch (e) {
    const hint =
      (e as Error).message.endsWith('a key') && preset.keyEnv ? `: set ${preset.keyEnv} or LOADMAP_AI_KEY` : ''
    const model = (e as Error).message.endsWith("model's name") ? ': set LOADMAP_AI_MODEL or pass --model' : ''
    throw new Error(`${(e as Error).message}${hint}${model}`)
  }
}
