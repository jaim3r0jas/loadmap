// The editor's one switch for GitHub, in its bar: "Connect to GitHub" (or "Reconnect <login>" when this browser
// connected before), then the account and its menu: open a repository, a new one, the app's repositories on GitHub, a
// pasted token instead, disconnect. Drawn from account.ts alone; the GitHub code loads on the first press.
import { Icon, Menu, MenuItem } from '@loadmap/editor/internal'
import { useEffect, useState } from 'react'
import { type Account, account, installUrl, onAccount, signInConfig } from './account'

const APP = signInConfig()
/** A person: the account, connected or not. */
const PERSON = 'M8 8.2a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2zM3 13.5c.6-2.4 2.6-3.6 5-3.6s4.4 1.2 5 3.6'
const CSS = `
.app-account .app-label { max-width: 160px; overflow: hidden; text-overflow: ellipsis; }
`

export interface AccountButtonProps {
  onOpen: () => void
  onNewRepo: () => void
  /** The connect dialog: a build without the app, the reader's choice of a pasted token, or why the popup failed. */
  onDialog: (o: { paste?: boolean; error?: string }) => void
}

/** The GitHub chunk, asked for as the pointer nears the button: the popup then opens within the press. */
const github = () => import('./index')

export default function AccountButton({ onOpen, onNewRepo, onDialog }: AccountButtonProps) {
  const [now, setNow] = useState<Account>(account)
  useEffect(() => onAccount(setNow), [])
  const [busy, setBusy] = useState(false)

  const connect = async () => {
    if (!APP) return onDialog({})
    if (busy) return
    setBusy(true)
    try {
      await (await github()).connect()
    } catch (e) {
      onDialog({ error: e instanceof Error ? e.message : 'GitHub did not connect.' })
    } finally {
      setBusy(false)
    }
  }
  const disconnect = () => void import('./session').then((m) => m.disconnect())
  const reconnect = APP && now.via === 'app' && now.login

  if (!now.connected) {
    const label = busy ? 'Connecting…' : reconnect ? `Reconnect ${now.login}` : 'Connect to GitHub'
    return (
      <>
        <style>{CSS}</style>
        <button
          type="button"
          className="lm-btn lme-quiet app-account app-wide"
          aria-label={label}
          title={reconnect ? `Connect to GitHub again, as ${now.login}` : 'Open and save your repositories'}
          aria-disabled={busy}
          onPointerEnter={() => void github()}
          onFocus={() => void github()}
          onClick={connect}
        >
          <Icon d={PERSON} />
          <span className="app-label">{label}</span>
        </button>
        <button type="button" className="lme-item app-narrow" aria-disabled={busy} onClick={connect}>
          {label}
        </button>
      </>
    )
  }

  const who = now.login ?? 'GitHub'
  const items = (sheet?: boolean) => (
    <>
      <MenuItem sheet={sheet} onSelect={onOpen}>
        Open a repository…
      </MenuItem>
      <MenuItem sheet={sheet} hint="In your account, private unless you choose" onSelect={onNewRepo}>
        Save to a new repository…
      </MenuItem>
      {APP && now.via === 'app' && (
        <MenuItem
          sheet={sheet}
          hint="The app reads and writes only those"
          onSelect={() => window.open(installUrl(APP), '_blank', 'noopener,noreferrer')}
        >
          Choose repositories on GitHub ↗
        </MenuItem>
      )}
      {APP && now.via === 'app' && (
        <MenuItem sheet={sheet} onSelect={() => onDialog({ paste: true })}>
          Use a pasted token instead
        </MenuItem>
      )}
      <MenuItem sheet={sheet} hint="This browser forgets the token and the account" onSelect={disconnect}>
        Disconnect
      </MenuItem>
    </>
  )
  return (
    <>
      <style>{CSS}</style>
      <Menu
        label={`GitHub: ${who}`}
        title={
          now.via === 'app'
            ? `Connected to GitHub as ${who}`
            : `Connected to GitHub with a token${now.login ? `, as ${who}` : ''}`
        }
        className="lme-quiet app-account app-wide"
        icon={
          <>
            <Icon d={PERSON} />
            <span className="app-label">{who}</span>
          </>
        }
      >
        {() => items()}
      </Menu>
      {/* biome-ignore lint/a11y/useSemanticElements: rows of the phone's sheet under a heading, as the theme's */}
      <div className="app-narrow" role="group" aria-label={`GitHub: ${who}`}>
        <div className="theme-caption lme-mh">GitHub: {who}</div>
        {items(true)}
      </div>
    </>
  )
}
