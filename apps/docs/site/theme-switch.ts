// The switch's markup: pages.ts writes it into each page, the editor draws it in its bar. theme.ts makes it work.
import type { Choice } from './theme'

const ICONS: Record<Choice, string> = {
  system: '<rect x="2" y="3" width="12" height="8.5" rx="1.5"/><path d="M5.5 14h5M8 11.5V14"/>',
  light:
    '<circle cx="8" cy="8" r="2.8"/><path d="M8 1.2v1.6M8 13.2v1.6M1.2 8h1.6M13.2 8h1.6M3.2 3.2l1.1 1.1M11.7 11.7l1.1 1.1M3.2 12.8l1.1-1.1M11.7 4.3l1.1-1.1"/>',
  dark: '<path d="M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8a5.6 5.6 0 1 0 6.8 6.8z"/>',
}
const NAMES: Record<Choice, string> = { system: 'System', light: 'Light', dark: 'Dark' }
const TITLES: Record<Choice, string> = { system: 'Follow the system', light: 'Light', dark: 'Dark' }

/**
 * The switch: three radios, so the arrow keys and a screen reader know it without help. `name` keeps each switch on a
 * page its own group. The picked one shows from `data-theme` (docs.css), so it is right before any script runs;
 * `picked` checks it too, for a switch drawn after theme.ts has marked the others.
 */
export function themeSwitch(name: string, picked?: Choice): string {
  const options = (Object.keys(ICONS) as Choice[]).map(
    (c) =>
      `<label title="${TITLES[c]}"><input type="radio" name="${name}" value="${c}" autocomplete="off"${c === picked ? ' checked' : ''}><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">${ICONS[c]}</svg><span class="theme-name">${NAMES[c]}</span></label>`,
  )
  return `<div class="theme"><span class="theme-caption" aria-hidden="true">Theme</span><fieldset><legend>Theme</legend>${options.join('')}</fieldset></div>`
}
