// "Connect to GitHub": the site's GitHub App signs the reader in, in a popup, and the token it brings is this tab's,
// for every call the editor makes: open, save, a new repository, the sealed key. Loaded on the first press.
import { app as built, type SignIn } from './account'
import { takeToken } from './session'
import { browserHost, type SignInHost, signIn } from './signin'

/** The app this build connects with; without it, Connect asks for a pasted token. */
export const app = built

export interface ConnectOptions {
  app?: SignIn
  host?: SignInHost
  /**
   * A popup the press opened already, empty: the sign-in goes there. A press that first loads this code would
   * otherwise open it too late for a browser that wants a fresh click (Safari on a phone).
   */
  popup?: Window | null
  /** The account a reconnect is for: GitHub suggests it. */
  login?: string
}

/** Connects through the app; an error whose message the reader can act on. */
export async function connect(o: ConnectOptions = {}): Promise<void> {
  const config = o.app ?? app
  if (!config) {
    o.popup?.close()
    throw new Error('This site has no GitHub App: paste a token instead.')
  }
  const host = o.host ?? browserHost()
  const opened = o.popup
  const token = await signIn(
    config,
    opened
      ? {
          ...host,
          open: (url) => {
            opened.location.href = url
            return opened
          },
        }
      : host,
    o.login,
  )
  // an app's token lasts 8 hours: it is this tab's until then, a reload keeps it
  const wrong = takeToken(token, true, 'app')
  if (wrong) throw new Error(wrong)
}
