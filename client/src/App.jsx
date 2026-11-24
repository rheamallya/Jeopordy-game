import { useState } from 'react'
import BoardEditor from './components/BoardEditor.jsx'
import HostGame from './components/HostGame.jsx'
import PlayerGame from './components/PlayerGame.jsx'
import { emit } from './socket.js'
import { loadSession, saveSession, clearSession } from './session.js'

function initialView() {
  const urlCode = new URLSearchParams(window.location.search).get('code')
  if (urlCode) return 'play'
  const s = loadSession()
  if (s?.role === 'host') return 'host'
  if (s?.role === 'player') return 'play'
  return 'home'
}

export default function App() {
  const [view, setView] = useState(initialView)
  const [hostCode, setHostCode] = useState(() => {
    const s = loadSession()
    return s?.role === 'host' ? s.code : null
  })
  const [notice, setNotice] = useState('')

  const goHome = () => {
    clearSession()
    setHostCode(null)
    window.history.replaceState({}, '', '/')
    setView('home')
  }

  const startGame = async (board) => {
    const res = await emit('host:createGame', board)
    if (!res.ok) return res.error || 'Could not create game.'
    saveSession({ role: 'host', code: res.code })
    setHostCode(res.code)
    return null
  }

  if (view === 'host') {
    if (hostCode) {
      return (
        <HostGame
          code={hostCode}
          onLost={() => {
            clearSession()
            setHostCode(null)
            setNotice('That game is no longer running (the server may have restarted).')
          }}
          onExit={goHome}
        />
      )
    }
    return <BoardEditor onStart={startGame} onBack={goHome} notice={notice} />
  }

  if (view === 'play') return <PlayerGame onExit={goHome} />

  return (
    <main className="home">
      <div className="home-card">
        <p className="eyebrow">Live trivia for any room</p>
        <h1 className="logo">Trivia Board</h1>
        <p className="lede">
          Build a board of categories and point values, then players join from their phones with a game code, solo
          or as a team of two.
        </p>
        <div className="home-actions">
          <button className="btn btn-primary btn-lg" onClick={() => setView('host')}>
            Host a game
          </button>
          <button className="btn btn-secondary btn-lg" onClick={() => setView('play')}>
            Join a game
          </button>
        </div>
      </div>
    </main>
  )
}
