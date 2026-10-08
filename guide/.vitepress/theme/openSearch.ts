// The default theme opens its local search on Ctrl+K and offers no other way in.
export function openSearch() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))
}
