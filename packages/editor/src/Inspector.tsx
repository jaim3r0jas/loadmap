import type {
  EditValue,
  FormulaPart,
  InspectField,
  Inspection,
  InspectSection,
  OptionValue,
  Provenance,
} from '@loadmap/dsl/internal'
import { type KeyboardEvent, type ReactNode, useId, useState } from 'react'

export type InspectorTab = 'box' | 'model'

export interface InspectorProps {
  /** The fields of the box or of the model; null when there is nothing to show. */
  inspection: Inspection | null
  tab: InspectorTab
  onTab: (tab: InspectorTab) => void
  /** Makes a change; returns why it was refused, or null. */
  onEdit: (key: string, value: EditValue) => string | null
  /** Why nothing can be changed now. */
  blocked?: string
  /** A box is selected but no longer in the text. */
  gone?: boolean
  /** Lets go of the box: on a phone the panel shrinks back to its hint. */
  onClose?: () => void
}

/**
 * The fields of a box or of the model, for a reader who does not read the text. Every change goes back to the text
 * as the smallest edit; a change the definition would not take is refused under its field.
 */
export function Inspector({ inspection, tab, onTab, onEdit, blocked, gone, onClose }: InspectorProps) {
  return (
    <aside className="lme-inspector" aria-label="Inspector">
      <div className="lme-tabs" role="tablist">
        {(['box', 'model'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            className="lm-btn"
            aria-selected={tab === t}
            onClick={() => onTab(t)}
          >
            {t === 'box' ? 'Box' : 'Model'}
          </button>
        ))}
        <span className="lme-grow" />
        {onClose && tab === 'box' && inspection && (
          <button type="button" className="lm-btn" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        )}
      </div>
      {blocked ? (
        <p className="lme-hint" data-kind="blocked">
          {blocked}
        </p>
      ) : !inspection ? (
        <p className="lme-hint">
          {gone ? 'That box is no longer in the definition.' : 'Click a box in the diagram to change it.'}
        </p>
      ) : (
        <>
          <h3>{inspection.title}</h3>
          {inspection.sections.map((s) => (
            <Section key={`${s.keyword}:${s.id ?? s.title}`} s={s} onEdit={onEdit} />
          ))}
        </>
      )}
    </aside>
  )
}

const LEGEND: Record<string, (s: InspectSection) => string> = {
  '': () => 'Model',
  node: () => 'Box',
  cluster: () => 'Box',
  pool: () => 'Box',
  param: (s) => `Parameter · ${s.title}`,
  flow: (s) => `Flow · ${s.title}`,
  component: (s) => `Component · ${s.title}`,
  fit: (s) => `Fit · ${s.title}`,
}

function Section({ s, onEdit }: { s: InspectSection; onEdit: InspectorProps['onEdit'] }) {
  const main = s.fields.filter((f) => !f.more)
  const more = s.fields.filter((f) => f.more)
  return (
    <fieldset className="lme-section" data-keyword={s.keyword || 'model'}>
      <legend>{LEGEND[s.keyword]?.(s) ?? s.title}</legend>
      {main.map((f) => (
        <Field key={f.key} f={f} onEdit={onEdit} />
      ))}
      {more.length > 0 && (
        <details>
          <summary>More</summary>
          {more.map((f) => (
            <Field key={f.key} f={f} onEdit={onEdit} />
          ))}
        </details>
      )}
    </fieldset>
  )
}

function Field({ f, onEdit }: { f: InspectField; onEdit: InspectorProps['onEdit'] }) {
  const [error, setError] = useState<string | null>(null)
  const commit = (key: string, v: EditValue) => setError(onEdit(key, v))
  const id = useId()
  let control: ReactNode
  switch (f.kind) {
    case 'text':
      control = <Text id={id} value={f.value} onCommit={(v) => commit(f.key, v)} />
      break
    case 'number':
      control = (
        <Text
          id={id}
          value={String(f.value)}
          inputMode="decimal"
          onCommit={(v) => {
            const n = toNumber(v)
            if (typeof n === 'string') setError(n)
            else commit(f.key, n)
          }}
        />
      )
      break
    case 'boolean':
      control = <input id={id} type="checkbox" checked={f.value} onChange={(e) => commit(f.key, e.target.checked)} />
      break
    case 'choice':
      control = (
        <select
          id={id}
          value={String(f.value)}
          onChange={(e) => commit(f.key, f.choices.find((c) => String(c) === e.target.value) ?? e.target.value)}
        >
          {f.choices.map((c) => (
            <option key={String(c)} value={String(c)}>
              {String(c)}
            </option>
          ))}
        </select>
      )
      break
    case 'options':
      control = (
        <Text
          id={id}
          value={f.value.join(', ')}
          onCommit={(v) => {
            const o = toOptions(v)
            if (typeof o === 'string') setError(o)
            else commit(f.key, o)
          }}
        />
      )
      break
    case 'formula':
      control = (
        <Formula
          id={id}
          label={f.label}
          parts={f.parts}
          onSlot={(n, v) => commit(`${f.key}#${n}`, v)}
          onError={setError}
        />
      )
      break
    case 'capacity':
      return <Capacity f={f} onEdit={onEdit} />
  }
  return (
    <div className="lme-field" data-key={f.key} data-kind={f.kind}>
      <label htmlFor={id} title={f.doc || undefined}>
        {f.label}
      </label>
      {control}
      {f.kind === 'options' && <small>separated by commas</small>}
      {error && (
        <small className="lme-error" role="alert">
          {error}
        </small>
      )}
    </div>
  )
}

function Capacity({ f, onEdit }: { f: Extract<InspectField, { kind: 'capacity' }>; onEdit: InspectorProps['onEdit'] }) {
  const [error, setError] = useState<string | null>(null)
  const commit = (part: string, v: EditValue) => setError(onEdit(`${f.key}${part}`, v))
  const id = useId()
  return (
    <fieldset className="lme-field lme-capacity" data-key={f.key} data-kind="capacity">
      <legend title={f.doc}>{f.label}</legend>
      <Formula id={`${id}v`} label={f.label} parts={f.value} onSlot={(n, v) => commit(`#${n}`, v)} onError={setError} />
      <div className="lme-row">
        <label htmlFor={`${id}w`}>±</label>
        <Text
          id={`${id}w`}
          value={typeof f.within === 'number' ? String(f.within) : ''}
          inputMode="decimal"
          disabled={f.within === 'formula' || f.provenance === 'configured'}
          placeholder={f.provenance === 'configured' ? 'exact' : 'none'}
          onCommit={(v) => {
            if (!v.trim()) return commit('.within', null)
            const n = toNumber(v)
            if (typeof n === 'string') setError(n)
            else commit('.within', n)
          }}
        />
        <span>{f.percent ? '%' : f.unit}</span>
      </div>
      <div className="lme-row">
        <label htmlFor={`${id}u`}>Unit</label>
        <Text id={`${id}u`} value={f.unit} onCommit={(v) => commit('.unit', v)} />
      </div>
      <div className="lme-row">
        <label htmlFor={`${id}p`}>Known by</label>
        <select
          id={`${id}p`}
          value={f.provenance}
          onChange={(e) => commit('.provenance', e.target.value as Provenance)}
        >
          <option value="measured">measured</option>
          <option value="estimated">estimated</option>
          <option value="configured">configured</option>
        </select>
      </div>
      <div className="lme-row">
        <label htmlFor={`${id}s`}>Source</label>
        <Text
          id={`${id}s`}
          value={f.source ?? ''}
          placeholder="none"
          onCommit={(v) => commit('.source', v.trim() ? v : null)}
        />
      </div>
      {error && (
        <small className="lme-error" role="alert">
          {error}
        </small>
      )}
    </fieldset>
  )
}

/** A formula as written, its numbers as fields. */
function Formula({
  id,
  label,
  parts,
  onSlot,
  onError,
}: {
  id: string
  label: string
  parts: FormulaPart[]
  onSlot: (n: number, v: number) => void
  onError: (e: string) => void
}) {
  const slots = parts.filter((p) => typeof p !== 'string').length
  return (
    <span className="lme-formula" id={id}>
      {parts.map((p, i) =>
        typeof p === 'string' ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one formula, in order
          <code key={i}>{p}</code>
        ) : (
          <Text
            key={`s${p.slot}`}
            value={String(p.value)}
            inputMode="decimal"
            size={Math.max(3, String(p.value).length + 1)}
            label={slots > 1 ? `${label}, number ${p.slot + 1}` : label}
            onCommit={(v) => {
              const n = toNumber(v)
              if (typeof n === 'string') onError(n)
              else onSlot(p.slot, n)
            }}
          />
        ),
      )}
    </span>
  )
}

/** A text field that changes the definition when it is left or Enter is pressed; Escape puts the value back. */
function Text({
  id,
  value,
  onCommit,
  label,
  ...rest
}: {
  id?: string
  value: string
  onCommit: (v: string) => void
  label?: string
  inputMode?: 'decimal'
  size?: number
  disabled?: boolean
  placeholder?: string
}) {
  const [draft, setDraft] = useState(value)
  // a new value from the text (an undo, another edit) replaces what was typed
  const [seen, setSeen] = useState(value)
  if (value !== seen) {
    setSeen(value)
    setDraft(value)
  }
  const done = () => {
    if (draft !== value) onCommit(draft)
  }
  const key = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') done()
    if (e.key === 'Escape') setDraft(value)
  }
  return (
    <input
      id={id}
      type="text"
      aria-label={label}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={done}
      onKeyDown={key}
      {...rest}
    />
  )
}

/** A number as people type it: 25000, 25_000, 25 000 or 0.5. */
function toNumber(s: string): number | string {
  const t = s.trim().replace(/[\s_]/g, '')
  if (t.includes(',')) return 'write decimals with a point: 0.5'
  const n = Number(t)
  return t && Number.isFinite(n) ? n : 'a number'
}

/** "2, 3, 4" are numbers; anything else is a list of texts. */
function toOptions(s: string): OptionValue[] | string {
  const items = s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
  if (!items.length) return 'at least one option'
  const numbers = items.map((x) => Number(x.replace(/_/g, '')))
  return numbers.every(Number.isFinite) ? numbers : items.map((x) => x.replace(/^["']|["']$/g, ''))
}
