import { useEffect, useMemo, useState } from 'react'
import { MODE_INFO } from './shared.js'

const DRAFT_KEY = 'trivia-board-draft'
const uid = () => Math.random().toString(36).slice(2, 10)

const blankQuestion = (value) => ({
  id: uid(),
  value,
  prompt: '',
  mode: 'match',
  answer: '',
  acceptedAnswers: [],
  timeLimit: 20,
})

function blankBoard(cats = 5, rows = 5) {
  return {
    title: 'My Trivia Night',
    categories: Array.from({ length: cats }, (_, i) => ({
      id: uid(),
      name: `Category ${i + 1}`,
      questions: Array.from({ length: rows }, (_, r) => blankQuestion((r + 1) * 100)),
    })),
  }
}

function loadDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY))
    if (d?.board?.categories) return d
  } catch {
    // ignore
  }
  return { board: blankBoard(), file: null }
}

export default function BoardEditor({ onStart, onBack, notice }) {
  const [{ board, file }, setDraft] = useState(loadDraft)
  const [editing, setEditing] = useState(null) // { catId, qId }
  const [saved, setSaved] = useState([])
  const [status, setStatus] = useState(notice || '')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ board, file }))
  }, [board, file])

  const refreshSaved = () =>
    fetch('/api/boards')
      .then((r) => r.json())
      .then(setSaved)
      .catch(() => setSaved([]))
  useEffect(() => {
    refreshSaved()
  }, [])

  const setBoard = (fn) => setDraft((d) => ({ ...d, board: fn(d.board) }))
  const updateCat = (catId, patch) =>
    setBoard((b) => ({ ...b, categories: b.categories.map((c) => (c.id === catId ? { ...c, ...patch } : c)) }))
  const updateQ = (catId, qId, patch) =>
    setBoard((b) => ({
      ...b,
      categories: b.categories.map((c) =>
        c.id === catId ? { ...c, questions: c.questions.map((q) => (q.id === qId ? { ...q, ...patch } : q)) } : c,
      ),
    }))

  const rows = Math.max(0, ...board.categories.map((c) => c.questions.length))

  const addCategory = () =>
    setBoard((b) => ({
      ...b,
      categories: [
        ...b.categories,
        {
          id: uid(),
          name: `Category ${b.categories.length + 1}`,
          questions: Array.from({ length: rows || 5 }, (_, r) => blankQuestion((r + 1) * 100)),
        },
      ],
    }))
  const removeCategory = (catId) => {
    if (!confirm('Remove this category and its questions?')) return
    setBoard((b) => ({ ...b, categories: b.categories.filter((c) => c.id !== catId) }))
  }
  const addRow = () =>
    setBoard((b) => ({
      ...b,
      categories: b.categories.map((c) => {
        const last = c.questions[c.questions.length - 1]
        return { ...c, questions: [...c.questions, blankQuestion((last?.value || 0) + 100)] }
      }),
    }))
  const removeRow = () =>
    setBoard((b) => ({ ...b, categories: b.categories.map((c) => ({ ...c, questions: c.questions.slice(0, -1) })) }))

  const stats = useMemo(() => {
    let filled = 0
    let empty = 0
    let missingAnswer = 0
    for (const c of board.categories) {
      for (const q of c.questions) {
        if (!q.prompt.trim()) empty += 1
        else {
          filled += 1
          if (q.mode !== 'vote' && !q.answer.trim()) missingAnswer += 1
        }
      }
    }
    return { filled, empty, missingAnswer }
  }, [board])

  const loadBoard = async (f) => {
    if (!f) return
    if (stats.filled > 0 && !confirm('Replace the current board with the saved one?')) return
    const data = await fetch(`/api/boards/${encodeURIComponent(f)}`).then((r) => r.json())
    const withIds = {
      title: data.title,
      categories: data.categories.map((c) => ({
        ...c,
        id: c.id || uid(),
        questions: c.questions.map((q) => ({ ...blankQuestion(q.value), ...q, id: q.id || uid() })),
      })),
    }
    setDraft({ board: withIds, file: f })
    setStatus(`Loaded “${data.title}”.`)
  }

  const save = async () => {
    setBusy(true)
    const res = await fetch('/api/boards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...board, file }),
    })
      .then((r) => r.json())
      .catch(() => ({ error: 'Could not reach the server.' }))
    setBusy(false)
    if (res.ok) {
      setDraft((d) => ({ ...d, file: res.file }))
      setStatus('Board saved.')
      refreshSaved()
    } else setStatus(res.error || 'Save failed.')
  }

  const start = async () => {
    if (stats.filled === 0) return setStatus('Add at least one question first.')
    if (stats.missingAnswer > 0 && !confirm(`${stats.missingAnswer} question(s) have no correct answer set. Start anyway?`))
      return
    setBusy(true)
    const err = await onStart(board)
    setBusy(false)
    if (err) setStatus(err)
  }

  const newBoard = () => {
    if (!confirm('Start a new blank board? Unsaved changes will be lost.')) return
    setDraft({ board: blankBoard(), file: null })
  }

  const editingCat = editing && board.categories.find((c) => c.id === editing.catId)
  const editingQ = editingCat?.questions.find((q) => q.id === editing.qId)

  return (
    <main className="editor">
      <header className="topbar">
        <button className="btn btn-ghost" onClick={onBack}>
          ← Home
        </button>
        <input
          className="title-input"
          value={board.title}
          onChange={(e) => setBoard((b) => ({ ...b, title: e.target.value }))}
          aria-label="Board title"
        />
        <div className="topbar-actions">
          <select value="" onChange={(e) => loadBoard(e.target.value)} aria-label="Load a saved board">
            <option value="">Load saved board…</option>
            {saved.map((s) => (
              <option key={s.file} value={s.file}>
                {s.title}
              </option>
            ))}
          </select>
          <button className="btn btn-ghost" onClick={newBoard}>
            New
          </button>
          <button className="btn btn-secondary" onClick={save} disabled={busy}>
            Save
          </button>
          <button className="btn btn-primary" onClick={start} disabled={busy}>
            Start game →
          </button>
        </div>
      </header>

      <p className="editor-help">
        Click a tile to write its question. {stats.filled} ready
        {stats.empty > 0 && <> · {stats.empty} empty (skipped)</>}
        {stats.missingAnswer > 0 && <span className="warn"> · {stats.missingAnswer} missing an answer</span>}
        {status && <span className="status"> · {status}</span>}
      </p>

      <div
        className="editor-grid"
        style={{ gridTemplateColumns: `repeat(${board.categories.length}, minmax(140px, 1fr)) 56px` }}
      >
        {board.categories.map((c) => (
          <div key={c.id} className="cat-head editable">
            <input value={c.name} onChange={(e) => updateCat(c.id, { name: e.target.value })} aria-label="Category name" />
            <button className="btn-icon" title="Remove category" onClick={() => removeCategory(c.id)}>
              ×
            </button>
          </div>
        ))}
        <button className="add-col" onClick={addCategory} title="Add category">
          +
        </button>

        {Array.from({ length: rows }).map((_, r) => (
          <RowCells key={r} r={r} board={board} onEdit={(catId, qId) => setEditing({ catId, qId })} />
        ))}
      </div>
      <div className="row-controls">
        <button className="btn btn-ghost" onClick={addRow}>
          + Add row
        </button>
        <button className="btn btn-ghost" onClick={removeRow} disabled={rows === 0}>
          − Remove last row
        </button>
      </div>

      {editingQ && (
        <QuestionModal
          category={editingCat}
          question={editingQ}
          onChange={(patch) => updateQ(editingCat.id, editingQ.id, patch)}
          onClose={() => setEditing(null)}
        />
      )}
    </main>
  )
}

function RowCells({ r, board, onEdit }) {
  return (
    <>
      {board.categories.map((c) => {
        const q = c.questions[r]
        if (!q) return <div key={`${c.id}-${r}`} className="cell empty" />
        const filled = q.prompt.trim()
        const needsAnswer = filled && q.mode !== 'vote' && !q.answer.trim()
        return (
          <button
            key={q.id}
            className={`cell edit-cell ${filled ? 'filled' : ''} ${needsAnswer ? 'needs' : ''}`}
            onClick={() => onEdit(c.id, q.id)}
          >
            <span className="val">{q.value}</span>
            <span className="snippet">{filled ? q.prompt : 'Add question'}</span>
            <span className="mode-tag">{MODE_INFO[q.mode].label}</span>
          </button>
        )
      })}
      <div />
    </>
  )
}

function QuestionModal({ category, question, onChange, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Edit question">
        <header>
          <h2>
            {category.name} · {question.value}
          </h2>
          <button className="btn-icon" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <label>
          Points
          <input
            type="number"
            step="100"
            min="0"
            value={question.value}
            onChange={(e) => onChange({ value: Number(e.target.value) })}
          />
        </label>

        <label>
          Question / clue
          <textarea
            autoFocus
            rows={3}
            value={question.prompt}
            onChange={(e) => onChange({ prompt: e.target.value })}
            placeholder="This planet is known as the Red Planet."
          />
        </label>

        <fieldset className="mode-pick">
          <legend>How players answer</legend>
          {Object.entries(MODE_INFO).map(([mode, info]) => (
            <label key={mode} className={question.mode === mode ? 'on' : ''}>
              <input type="radio" name="mode" checked={question.mode === mode} onChange={() => onChange({ mode })} />
              <strong>{info.label}</strong>
              <small>{info.short}</small>
            </label>
          ))}
        </fieldset>

        {question.mode !== 'vote' && (
          <>
            <label>
              Correct answer
              <input value={question.answer} onChange={(e) => onChange({ answer: e.target.value })} placeholder="Mars" />
            </label>
            {question.mode === 'match' && (
              <label>
                Also accept <small>(comma-separated)</small>
                <input
                  value={question.acceptedAnswers.join(', ')}
                  onChange={(e) => onChange({ acceptedAnswers: e.target.value.split(',').map((s) => s.trimStart()) })}
                  placeholder="planet mars, the red planet"
                />
              </label>
            )}
          </>
        )}

        {question.mode !== 'buzzer' && (
          <label>
            Time to answer (seconds)
            <input
              type="number"
              min="5"
              max="300"
              value={question.timeLimit}
              onChange={(e) => onChange({ timeLimit: Number(e.target.value) })}
            />
          </label>
        )}

        <footer>
          <button className="btn btn-ghost" onClick={() => onChange({ prompt: '', answer: '', acceptedAnswers: [] })}>
            Clear
          </button>
          <button className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </div>
  )
}
