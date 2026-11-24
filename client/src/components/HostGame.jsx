import { useEffect, useRef, useState } from 'react'
import { socket, emit, onEveryConnect } from '../socket.js'
import { BoardGrid, Countdown, Scoreboard, Standings } from './common.jsx'
import { MODE_INFO, withClock } from './shared.js'

export default function HostGame({ code, onLost, onExit }) {
  const [state, setState] = useState(null)
  const [error, setError] = useState('')
  const onLostRef = useRef(onLost)
  useEffect(() => {
    onLostRef.current = onLost
  }, [onLost])

  useEffect(() => {
    const onState = (s) => setState(withClock(s))
    socket.on('host:state', onState)
    const off = onEveryConnect(async () => {
      const res = await emit('host:rejoin', code)
      if (!res.ok) onLostRef.current()
    })
    return () => {
      socket.off('host:state', onState)
      off()
    }
  }, [code])

  const act = async (event, payload) => {
    setError('')
    const res = await emit(event, payload)
    if (!res.ok && res.error) setError(res.error)
  }

  if (!state) return <main className="center-msg">Connecting…</main>

  const adjust = (unitId, delta) => act('host:adjustScore', { unitId, delta })
  const endGame = () => confirm('End the game now and show final standings?') && act('host:endGame')

  return (
    <main className="host">
      <header className="topbar">
        <div className="brand">{state.board.title}</div>
        <div className="code-pill" title="Game code">
          Code <strong>{state.code}</strong>
        </div>
        <div className="topbar-actions">
          {state.phase !== 'ended' && state.phase !== 'lobby' && (
            <button className="btn btn-ghost" onClick={endGame}>
              End game
            </button>
          )}
          {state.phase === 'ended' && (
            <button className="btn btn-primary" onClick={onExit}>
              New game
            </button>
          )}
        </div>
      </header>
      {error && <p className="error-bar">{error}</p>}

      {state.phase === 'lobby' && <Lobby state={state} onStart={() => act('host:startGame')} />}

      {state.phase === 'board' && (
        <div className="host-layout">
          <BoardGrid board={state.board} onPick={(id) => act('host:reveal', id)} />
          <Scoreboard scoreboard={state.board.scoreboard} onAdjust={adjust} />
        </div>
      )}

      {state.phase === 'question' && state.current && (
        <div className="host-layout">
          <HostQuestion key={state.current.questionId} q={state.current} offset={state.clockOffset} act={act} />
          <Scoreboard scoreboard={state.board.scoreboard} onAdjust={adjust} />
        </div>
      )}

      {state.phase === 'ended' && <Standings scoreboard={state.board.scoreboard} />}
    </main>
  )
}

function Lobby({ state, onStart }) {
  const [hosts, setHosts] = useState([])
  useEffect(() => {
    fetch('/api/info')
      .then((r) => r.json())
      .then((d) => setHosts(d.lanAddresses || []))
      .catch(() => {})
  }, [])

  const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)
  const port = window.location.port ? `:${window.location.port}` : ''
  const joinUrls = isLocal
    ? hosts.map((ip) => `${window.location.protocol}//${ip}${port}`)
    : [window.location.origin]

  const { units, players } = state.lobby
  const undecided = players.filter((p) => !p.unitId)

  return (
    <section className="lobby">
      <div className="join-info">
        <p className="eyebrow">Join on your phone</p>
        <div className="big-code">{state.code}</div>
        {joinUrls.length > 0 ? (
          <p>
            Go to{' '}
            {joinUrls.map((u, i) => (
              <span key={u}>
                {i > 0 && ' or '}
                <strong className="url">{u.replace(/^https?:\/\//, '')}</strong>
              </span>
            ))}{' '}
            and enter the code.
          </p>
        ) : (
          <p className="muted">Players on the same Wi-Fi can open this site and enter the code.</p>
        )}
      </div>

      <div className="lobby-roster">
        <h3>
          {units.length} {units.length === 1 ? 'entry' : 'entries'} · {players.length}{' '}
          {players.length === 1 ? 'player' : 'players'}
        </h3>
        <ul className="roster">
          {units.map((u) => (
            <li key={u.id}>
              <strong>{u.name}</strong>
              {u.isTeam ? (
                <span className="tag">
                  Team · {u.members.join(' & ')}
                  {u.size < 2 && ' (waiting for partner)'}
                </span>
              ) : (
                <span className="tag">Solo</span>
              )}
            </li>
          ))}
          {undecided.map((p) => (
            <li key={`p-${p.name}`} className="pending">
              <strong>{p.name}</strong>
              <span className="tag">choosing solo or team…</span>
            </li>
          ))}
        </ul>
        <button className="btn btn-primary btn-lg" onClick={onStart} disabled={units.length === 0}>
          Start game
        </button>
        {units.length === 0 && <p className="muted">Waiting for at least one player.</p>}
      </div>
    </section>
  )
}

function HostQuestion({ q, offset, act }) {
  const [showAnswer, setShowAnswer] = useState(false)
  const results = q.stage === 'results'

  return (
    <section className="question-panel">
      <div className="q-meta">
        <span>
          {q.categoryName} · <strong>{q.value}</strong>
        </span>
        <span className="mode-badge">{MODE_INFO[q.mode].label}</span>
        <Countdown deadline={q.deadline} offset={offset} />
      </div>
      <h1 className="q-prompt">{q.prompt}</h1>

      {q.mode !== 'vote' && (
        <div className="answer-reveal">
          {showAnswer || results || q.stage === 'review' ? (
            <p>
              Answer: <strong>{q.answer || '—'}</strong>
              {q.acceptedAnswers?.length > 0 && <small> (also: {q.acceptedAnswers.join(', ')})</small>}
            </p>
          ) : (
            <button className="btn btn-ghost btn-sm" onClick={() => setShowAnswer(true)}>
              Show answer (host only)
            </button>
          )}
        </div>
      )}

      {q.mode === 'match' && <MatchHost q={q} act={act} />}
      {q.mode === 'vote' && <VoteHost q={q} act={act} />}
      {q.mode === 'buzzer' && <BuzzerHost q={q} act={act} />}

      {results && (
        <button className="btn btn-primary btn-lg" onClick={() => act('host:backToBoard')}>
          Back to board →
        </button>
      )}
    </section>
  )
}

function Progress({ done, total, label }) {
  return (
    <div className="progress">
      <div className="bar">
        <div style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
      </div>
      <span>
        {done} / {total} {label}
      </span>
    </div>
  )
}

function MatchHost({ q, act }) {
  const [overrides, setOverrides] = useState({})

  if (q.stage === 'collecting') {
    return (
      <div className="stage">
        <Progress done={q.submissions.length} total={q.totalUnits} label="answered" />
        <p className="muted">{q.submissions.map((s) => s.unitName).join(', ') || 'Waiting for answers…'}</p>
        <button className="btn btn-secondary" onClick={() => act('host:endSubmissions')}>
          Close answers now
        </button>
      </div>
    )
  }

  if (q.stage === 'review') {
    const isCorrect = (r) => (r.unitId in overrides ? overrides[r.unitId] : r.autoCorrect)
    return (
      <div className="stage">
        <h3>Review answers</h3>
        <p className="muted">Auto-graded with typo tolerance. Tap to flip any you disagree with.</p>
        {q.reviewResults.length === 0 && <p>No one answered.</p>}
        <ul className="review-list">
          {q.reviewResults.map((r) => (
            <li key={r.unitId}>
              <span className="who">{r.unitName}</span>
              <span className="said">“{r.text || '(blank)'}”</span>
              <button
                className={`judge ${isCorrect(r) ? 'yes' : 'no'}`}
                onClick={() => setOverrides((o) => ({ ...o, [r.unitId]: !isCorrect(r) }))}
              >
                {isCorrect(r) ? '✓ Correct' : '✗ Wrong'}
              </button>
            </li>
          ))}
        </ul>
        <button className="btn btn-primary btn-lg" onClick={() => act('host:finalizeMatch', overrides)}>
          Award points
        </button>
      </div>
    )
  }

  return (
    <div className="stage">
      <ul className="review-list">
        {(q.finalResults || []).map((r) => (
          <li key={r.unitId}>
            <span className="who">{r.unitName}</span>
            <span className="said">“{r.text || '(blank)'}”</span>
            <span className={`judge ${r.correct ? 'yes' : 'no'}`}>{r.correct ? `+${q.value}` : '✗'}</span>
          </li>
        ))}
      </ul>
      {(q.finalResults || []).length === 0 && <p>No one answered.</p>}
    </div>
  )
}

function VoteHost({ q, act }) {
  if (q.stage === 'collecting') {
    return (
      <div className="stage">
        <Progress done={q.submissions.length} total={q.totalUnits} label="answered" />
        <button className="btn btn-secondary" onClick={() => act('host:endSubmissions')}>
          Start voting now
        </button>
      </div>
    )
  }
  if (q.stage === 'voting') {
    return (
      <div className="stage">
        <h3>Vote for the best answer</h3>
        <ul className="vote-list">
          {q.voteOptions.map((o) => (
            <li key={o.id}>
              <span className="label">{o.label}</span>
              <span className="said">{o.text || '(blank)'}</span>
            </li>
          ))}
        </ul>
        {q.voteOptions.length === 0 && <p>No answers were submitted.</p>}
        <Progress done={q.votesCount} total={q.totalUnits} label="voted" />
        <button className="btn btn-secondary" onClick={() => act('host:endVoting')}>
          End voting
        </button>
      </div>
    )
  }
  return (
    <div className="stage">
      <ul className="vote-list">
        {(q.finalResults || [])
          .slice()
          .sort((a, b) => b.votes - a.votes)
          .map((o) => (
            <li key={o.optionId} className={o.won ? 'won' : ''}>
              <span className="label">{o.label}</span>
              <span className="said">
                {o.text || '(blank)'} <small>— {o.unitName}</small>
              </span>
              <span className="votes">
                {o.votes} vote{o.votes === 1 ? '' : 's'}
                {o.won && ` · +${q.value}`}
              </span>
            </li>
          ))}
      </ul>
      {(q.finalResults || []).every((o) => !o.won) && <p className="muted">No votes, so no points awarded.</p>}
    </div>
  )
}

function BuzzerHost({ q, act }) {
  if (q.stage === 'open') {
    return (
      <div className="stage">
        <p className="pulse">Buzzers are open…</p>
        {q.triedUnitIds.length > 0 && <p className="muted">{q.triedUnitIds.length} already tried and missed.</p>}
        <button className="btn btn-secondary" onClick={() => act('host:backToBoard')}>
          No one got it, back to board
        </button>
      </div>
    )
  }
  if (q.stage === 'answering') {
    return (
      <div className="stage">
        <h2 className="buzzed">{q.lockedUnitName} buzzed in!</h2>
        <p className="said big">{q.buzzerAnswer ? `“${q.buzzerAnswer.text}”` : 'Typing their answer…'}</p>
        <div className="judge-row">
          <button className="btn btn-good btn-lg" onClick={() => act('host:judgeBuzzer', true)}>
            ✓ Correct
          </button>
          <button className="btn btn-bad btn-lg" onClick={() => act('host:judgeBuzzer', false)}>
            ✗ Wrong
          </button>
        </div>
      </div>
    )
  }
  const r = q.finalResults || {}
  return (
    <div className="stage">
      {r.winnerUnitId ? (
        <p className="said big">
          {r.winnerName} got it! +{q.value} {r.answer && <>for “{r.answer}”</>}
        </p>
      ) : (
        <p className="said big">Nobody got it.</p>
      )}
    </div>
  )
}
