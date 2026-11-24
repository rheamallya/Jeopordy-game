// Per-tab session so a refresh rejoins the same game. sessionStorage (not
// localStorage) lets you test several players from tabs in one browser.
const KEY = 'trivia-board-session'

export function loadSession() {
  try {
    return JSON.parse(sessionStorage.getItem(KEY)) || null
  } catch {
    return null
  }
}

export function saveSession(session) {
  sessionStorage.setItem(KEY, JSON.stringify(session))
}

export function clearSession() {
  sessionStorage.removeItem(KEY)
}
