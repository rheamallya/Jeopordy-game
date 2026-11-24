import { useEffect, useRef, useState } from 'react'
import { socket, emit, onEveryConnect } from '../socket.js'
import { loadSession, saveSession, clearSession } from '../session.js'
import { BoardGrid, Countdown, Scoreboard, Standings } from './common.jsx'
import { MODE_INFO, withClock } from './shared.js'

export default function PlayerGame({ onExit }) {
  const urlCode = new URLSearchParams(window.location.search).get('code') || ''
  const [session, setSession] = useState(() => {
    const s = loadSession()
    if (s?.role !== 'player') return null
    if (urlCode && s.code !== urlCode.toUpperCase()) return null
    return s
  })
  const [state, setState] = useState(null)
  const [lostMsg, setLostMsg] = useState('')

  useEffect(() => {
    const onState = (s) => setState(withClock(s))
    socket.on('player:state', onState)
    return () => socket.off('player:state', onState)
  }, [])

  useEffect(() => {
    if (!session) return undefined
    return onEveryConnect(async () => {
      const res = await emit('player:rejoin', { code: session.code, playerId: session.playerId })
      if (!res.ok) {
        clearSession()
        setSession(null)
        setState(null)
        setLostMsg('That game has ended or the server restarted. Join again with a new code.')
      }
    })
  }, [session])

  const onJoined = (s) => {
    saveSession(s)
    window.history.replaceState({}, '', '/')
    setSession(s)
  }

  if (!session) return <JoinForm initialCode={urlCode} onJoined={onJoined} onBack={onExit} notice={lostMsg} />
  if (!state) return <main className="center-msg">Connecting…</main>

  const leave = () => {
    if (confirm('Leave this game? You can rejoin with the same code, but as a new player.')) onExit()
  }

  const myUnit = state.board.scoreboard.find((u) => u.id === state.me.unitId)
  const rank = myUnit ? state.board.scoreboard.indexOf(myUnit) + 1 : null

  return (
    <main className="player">
      <header className="player-bar">
        <div>
          <strong>{myUnit?.name || state.me.name}</strong>
          {myUnit?.isTeam && <small> · {myUnit.members.join(' & ')}</small>}
        </div>
        {myUnit && (
          <div className="my-score">
            {myUnit.score}
            <small> pts · #{rank}</small>
          </div>
        )}
        <button className="btn btn-ghost btn-sm" onClick={leave}>
          Leave
        </button>
      </header>

      {!state.me.unitId && state.phase !== 'ended' ? (
        <ChooseMode state={state} />
      ) : (
        <PlayerPhase state={state} myUnitId={state.me.unitId} />
      )}
    </main>
  )
}

function JoinForm({ initialCode, onJoined, onBack, notice }) {
  const [code, setCode] = useState(initialCode.toUpperCase())
  const [name, setName] = useState('')
  const [error, setError] = useState(notice || '')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    const res = await emit('player:join', { code: code.trim().toUpperCase(), name: name.trim() })
    setBusy(false)
    if (!res.ok) return setError(res.error || 'Could not join.')
    onJoined({ role: 'player', code: res.code, playerId: res.playerId })
  }

  return (
    <main className="home">
      <form className="home-card join-form" onSubmit={submit}>
        <button type="button" className="btn btn-ghost btn-sm back" onClick={onBack}>
          ← Back
        </button>
        <h1 className="logo small">Join game</h1>
        <label>
          Game code
          <input
            className="code-input"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={5}
            autoCapitalize="characters"
            autoComplete="off"
            placeholder="ABCDE"
            required
          />
        </label>
        <label>
          Your name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={20} placeholder="Sam" required />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary btn-lg" disabled={busy}>
          Join
        </button>
      </form>
    </main>
  )
}

function ChooseMode({ state }) {
  const [teamName, setTeamName] = useState('')
  const [error, setError] = useState('')
  const openTeams = state.lobby.units.filter((u) => u.isTeam && u.size < 2)

  const go = async (event, payload) => {
    setError('')
    const res = await emit(event, payload)
    if (!res.ok) setError(res.error || 'Something went wrong.')
  }

  return (
    <section className="card choose">
      <h2>How are you playing?</h2>
      <button className="choice" onClick={() => go('player:chooseSolo')}>
        <strong>Solo</strong>
        <small>Play under your own name.</small>
      </button>

      {openTeams.length > 0 && (
        <div className="open-teams">
          <h3>Join a teammate</h3>
          {openTeams.map((t) => (
            <button key={t.id} className="choice" onClick={() => go('player:chooseTeam', t.name)}>
              <strong>{t.name}</strong>
              <small>with {t.members.join(', ')}</small>
            </button>
          ))}
        </div>
      )}

      <form
        className="new-team"
        onSubmit={(e) => {
          e.preventDefault()
          go('player:chooseTeam', teamName)
        }}
      >
        <h3>Start a team of two</h3>
        <div className="inline">
          <input
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            maxLength={24}
            placeholder="Team name"
            required
          />
          <button className="btn btn-secondary">Create</button>
        </div>
        <small className="muted">Your partner picks this team name on their phone to join you.</small>
      </form>
      {error && <p className="error">{error}</p>}
    </section>
  )
}

function PlayerPhase({ state, myUnitId }) {
  if (state.phase === 'lobby') {
    const myUnit = state.lobby.units.find((u) => u.id === myUnitId)
    return (
      <section className="card waiting">
        <h2>You're in!</h2>
        {myUnit?.isTeam && myUnit.size < 2 && <p>Waiting for your partner to join “{myUnit.name}”…</p>}
        <p className="muted">The host will start the game soon.</p>
        <p className="muted">{state.lobby.units.length} entries so far.</p>
      </section>
    )
  }

  if (state.phase === 'ended') return <Standings scoreboard={state.board.scoreboard} meUnitId={myUnitId} />

  if (state.phase === 'question' && state.current) {
    return <PlayerQuestion key={state.current.questionId} q={state.current} offset={state.clockOffset} myUnitId={myUnitId} />
  }

  return (
    <section className="card">
      <p className="muted center">The host is picking the next question…</p>
      <BoardGrid board={state.board} compact />
      <Scoreboard scoreboard={state.board.scoreboard} highlightUnitId={myUnitId} />
    </section>
  )
}

function PlayerQuestion({ q, offset, myUnitId }) {
  return (
    <section className="card question-card">
      <div className="q-meta">
        <span>
          {q.categoryName} · <strong>{q.value}</strong>
        </span>
        <span className="mode-badge">{MODE_INFO[q.mode].label}</span>
        <Countdown deadline={q.deadline} offset={offset} />
      </div>
      <h2 className="q-prompt">{q.prompt}</h2>
      {q.mode === 'match' && <MatchPlayer q={q} myUnitId={myUnitId} />}
      {q.mode === 'vote' && <VotePlayer q={q} />}
      {q.mode === 'buzzer' && <BuzzerPlayer q={q} myUnitId={myUnitId} />}
    </section>
  )
}

// Keyed by the current submission at the call site, so a teammate's
// submission for the team remounts it into the "Submitted" view.
function AnswerBox({ submitted, event, placeholder = 'Type your answer', autoFocus = true }) {
  const [text, setText] = useState(submitted || '')
  const [editing, setEditing] = useState(submitted == null)
  const [busy, setBusy] = useState(false)

  if (!editing) {
    return (
      <div className="submitted">
        <p>
          Submitted: <strong>“{submitted}”</strong>
        </p>
        <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
          Change answer
        </button>
      </div>
    )
  }
  return (
    <form
      className="answer-box"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!text.trim()) return
        setBusy(true)
        await emit(event, text.trim())
        setBusy(false)
      }}
    >
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={200}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete="off"
      />
      <button className="btn btn-primary" disabled={busy || !text.trim()}>
        Submit
      </button>
    </form>
  )
}

function MatchPlayer({ q, myUnitId }) {
  if (q.stage === 'collecting') {
    return (
      <>
        <AnswerBox key={q.mySubmission ?? ''} submitted={q.mySubmission} event="player:submitAnswer" />
        <p className="muted small">
          {q.submittedCount} / {q.totalUnits} answered
        </p>
      </>
    )
  }
  if (q.stage === 'review') return <p className="pulse">Host is checking answers…</p>
  const mine = (q.finalResults || []).find((r) => r.unitId === myUnitId)
  return (
    <div className="result">
      {mine ? (
        <p className={`verdict ${mine.correct ? 'yes' : 'no'}`}>{mine.correct ? `Correct! +${q.value}` : 'Not quite.'}</p>
      ) : (
        <p className="verdict no">No answer submitted.</p>
      )}
      <p>
        Answer: <strong>{q.answer}</strong>
      </p>
    </div>
  )
}

function VotePlayer({ q }) {
  if (q.stage === 'collecting') {
    return (
      <>
        <AnswerBox
          key={q.mySubmission ?? ''}
          submitted={q.mySubmission}
          event="player:submitAnswer"
          placeholder="Your best answer"
        />
        <p className="muted small">
          {q.submittedCount} / {q.totalUnits} answered · then everyone votes
        </p>
      </>
    )
  }
  if (q.stage === 'voting') {
    return (
      <div className="vote-options">
        <p className="muted">Vote for the best answer (you can't vote for your own):</p>
        {q.voteOptions.length === 0 && <p>No answers were submitted.</p>}
        {q.voteOptions.map((o) => {
          const mine = o.id === q.myOptionId
          return (
            <button
              key={o.id}
              className={`vote-btn ${q.myVoteId === o.id ? 'picked' : ''}`}
              disabled={mine}
              onClick={() => emit('player:vote', o.id)}
            >
              <span className="label">{o.label}</span>
              <span>{o.text || '(blank)'}</span>
              {mine && <small>yours</small>}
              {q.myVoteId === o.id && <small>✓ your vote</small>}
            </button>
          )
        })}
      </div>
    )
  }
  const results = (q.finalResults || []).slice().sort((a, b) => b.votes - a.votes)
  const mine = results.find((r) => r.optionId === q.myOptionId)
  return (
    <div className="result">
      {mine && <p className={`verdict ${mine.won ? 'yes' : 'no'}`}>{mine.won ? `Your answer won! +${q.value}` : 'Not this time.'}</p>}
      <ul className="vote-list">
        {results.map((o) => (
          <li key={o.optionId} className={o.won ? 'won' : ''}>
            <span className="label">{o.label}</span>
            <span className="said">
              {o.text} <small>— {o.unitName}</small>
            </span>
            <span className="votes">{o.votes}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function BuzzerPlayer({ q, myUnitId }) {
  const triedAlready = q.triedUnitIds.includes(myUnitId)
  const buzzingRef = useRef(false)

  if (q.stage === 'open') {
    if (triedAlready) return <p className="muted center">You already tried this one. Waiting for others…</p>
    return (
      <button
        className="buzzer"
        onClick={async () => {
          if (buzzingRef.current) return
          buzzingRef.current = true
          if (navigator.vibrate) navigator.vibrate(60)
          await emit('player:buzz')
          buzzingRef.current = false
        }}
      >
        BUZZ
      </button>
    )
  }
  if (q.stage === 'answering') {
    if (q.lockedUnitId === myUnitId) {
      if (q.buzzerAnswer) {
        return <p className="pulse">You answered “{q.buzzerAnswer.text}”. Waiting for the host…</p>
      }
      return (
        <>
          <p className="buzzed">You buzzed in! Answer quickly:</p>
          <AnswerBox submitted={null} event="player:submitBuzzerAnswer" />
        </>
      )
    }
    return (
      <p className="pulse">
        {q.lockedUnitName} buzzed in{q.buzzerAnswer ? `: “${q.buzzerAnswer.text}”` : '…'}
      </p>
    )
  }
  const r = q.finalResults || {}
  const won = r.winnerUnitId && r.winnerUnitId === myUnitId
  return (
    <div className="result">
      <p className={`verdict ${won ? 'yes' : 'no'}`}>
        {won ? `Correct! +${q.value}` : r.winnerUnitId ? `${r.winnerName} got it.` : 'Nobody got it.'}
      </p>
      <p>
        Answer: <strong>{q.answer}</strong>
      </p>
    </div>
  )
}
