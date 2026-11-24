import { io } from 'socket.io-client'

// Same origin in both dev (Vite proxies /socket.io) and production.
export const socket = io()

// Promise wrapper around socket.io acknowledgements.
export function emit(event, payload = null) {
  return new Promise((resolve) => {
    socket.timeout(8000).emit(event, payload, (err, res) => {
      resolve(err ? { ok: false, error: 'Server did not respond.' } : res || { ok: false })
    })
  })
}

// Run `fn` now if connected and again after every reconnect.
export function onEveryConnect(fn) {
  if (socket.connected) fn()
  socket.on('connect', fn)
  return () => socket.off('connect', fn)
}
