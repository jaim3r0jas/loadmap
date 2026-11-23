// "Connect to GitHub": the site's GitHub App signs the reader in, in a popup, and the token it brings is this tab's,
// for every call the editor makes: open, save, a new repository, the sealed key. Loaded on the first press.
import { signInConfig } from './account'
import { takeToken } from './session'
import { type SignIn, type SignInHost, signIn } from './signin'

/** The app this build connects with; without it, Connect asks for a pasted token. */
export const app: SignIn | undefined = signInConfig()

/** Connects through the app; an error whose message the reader can act on. */
export async function connect(o: { app?: SignIn; host?: SignInHost } = {}): Promise<void> {
  const config = o.app ?? app
  if (!config) throw new Error('This site has no GitHub App: paste a token instead.')
  const token = await signIn(config, o.host)
  // an app's token lasts 8 hours: it is this tab's until then, a reload keeps it
  const wrong = takeToken(token, true, 'app')
  if (wrong) throw new Error(wrong)
}
