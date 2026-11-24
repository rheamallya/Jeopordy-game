import { useEffect, useState } from 'react'

export function Countdown({ deadline, offset = 0 }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!deadline) return undefined
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [deadline])
  if (!deadline) return null
  const remaining = Math.max(0, Math.ceil((deadline - (now + offset)) / 1000))
  return (
    <div className={`countdown ${remaining <= 5 ? 'urgent' : ''}`} aria-live="polite">
      {remaining}
      <span>s</span>
    </div>
  )
}

export function Scoreboard({ scoreboard, highlightUnitId, onAdjust, title = 'Scores' }) {
  return (
    <section className="scoreboard">
      <h3>{title}</h3>
      {scoreboard.length === 0 && <p className="muted">No players yet.</p>}
      <ol>
        {scoreboard.map((u, i) => (
          <li key={u.id} className={u.id === highlightUnitId ? 'me' : ''}>
            <span className="rank">{i + 1}</span>
            <span className="who">
              <strong>{u.name}</strong>
              {u.isTeam && <small>{u.members.join(' & ')}</small>}
            </span>
            <span className={`pts ${u.score < 0 ? 'neg' : ''}`}>{u.score}</span>
            {onAdjust && (
              <span className="adjust">
                <button className="btn-icon" title="Subtract 100" onClick={() => onAdjust(u.id, -100)}>
                  −
                </button>
                <button className="btn-icon" title="Add 100" onClick={() => onAdjust(u.id, 100)}>
                  +
                </button>
              </span>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}

export function BoardGrid({ board, onPick, compact = false }) {
  const rows = Math.max(0, ...board.categories.map((c) => c.questions.length))
  return (
    <div
      className={`board-grid ${compact ? 'compact' : ''}`}
      style={{ gridTemplateColumns: `repeat(${board.categories.length}, minmax(0, 1fr))` }}
    >
      {board.categories.map((c) => (
        <div key={c.id} className="cat-head">
          {c.name}
        </div>
      ))}
      {Array.from({ length: rows }).flatMap((_, r) =>
        board.categories.map((c) => {
          const q = c.questions[r]
          if (!q) return <div key={`${c.id}-${r}`} className="cell empty" />
          return (
            <button
              key={q.id}
              className={`cell ${q.used ? 'used' : ''}`}
              disabled={q.used || !onPick}
              onClick={() => onPick?.(q.id)}
            >
              {q.used ? '' : q.value}
            </button>
          )
        }),
      )}
    </div>
  )
}

export function Standings({ scoreboard, meUnitId }) {
  const top = scoreboard[0]
  const winners = top ? scoreboard.filter((u) => u.score === top.score) : []
  return (
    <div className="standings">
      {winners.length > 0 ? (
        <h2 className="winner">
          {winners.length > 1 ? 'Tie: ' : ''}
          {winners.map((w) => w.name).join(' & ')} {winners.length > 1 ? 'win!' : 'wins!'}
        </h2>
      ) : (
        <h2>Game over</h2>
      )}
      <Scoreboard scoreboard={scoreboard} highlightUnitId={meUnitId} title="Final standings" />
    </div>
  )
}
