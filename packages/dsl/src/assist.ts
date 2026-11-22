// The assistant: a model asked about a definition, its answer read, checked by the compiler and returned as a
// proposal, never applied by itself. An entry of its own: no page loads it before the reader asks for it.
export { type Answer, type ExploreCall, readAnswer, readOperations } from './answer'
export {
  type AskRequest,
  type Assistant,
  type AssistantOptions,
  type AssistEvent,
  createAssistant,
  explored,
} from './assistant'
export {
  describe as describeOperation,
  type Figure,
  type GateOptions,
  type GateResult,
  gate,
  type Proposal,
} from './gate'
export { type DiffLine, diffLines } from './lines'
export {
  type AnthropicOptions,
  anthropic,
  type ChatEvent,
  type ChatMessage,
  type ChatRequest,
  ModelError,
  type ModelProvider,
  type OpenAICompatibleOptions,
  openaiCompatible,
  recorded,
  type Usage,
} from './models'
export { PROVIDER_ORIGINS, PROVIDERS, type ProviderPreset, providerFor, providerFromEnv } from './presets'
export { boxFacts, contextText, facts, PROTOCOL, type Selection, systemText } from './prompt'
