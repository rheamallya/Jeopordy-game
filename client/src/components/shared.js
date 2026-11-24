export const MODE_INFO = {
  match: {
    label: 'Typed answer',
    short: 'Everyone types an answer; close matches are auto-graded and you can override.',
  },
  buzzer: {
    label: 'Buzzer',
    short: 'First to buzz types an answer; you judge it. Wrong answers reopen the buzzer.',
  },
  vote: {
    label: 'Crowd vote',
    short: 'Open-ended: everyone answers, then players vote for the best one (not their own).',
  },
}

// Attach the client/server clock difference to each snapshot as it arrives.
export function withClock(state) {
  return { ...state, clockOffset: state.serverNow - Date.now() }
}
