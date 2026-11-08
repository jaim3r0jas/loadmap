/** VS Code's theme on <html>, where `theme="inherit"` reads it: its body classes say light, dark or high contrast. */
export function followTheme(): () => void {
  const set = () => {
    const c = document.body.classList
    const dark =
      (c.contains('vscode-dark') || c.contains('vscode-high-contrast')) && !c.contains('vscode-high-contrast-light')
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  }
  set()
  const o = new MutationObserver(set)
  o.observe(document.body, { attributes: true, attributeFilter: ['class'] })
  return () => o.disconnect()
}
