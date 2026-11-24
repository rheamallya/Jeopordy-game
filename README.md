# Trivia Board

A board-style trivia game for a room full of people. The host builds a board of
categories and point values; players join from their phones with a game code,
play solo or as a team of two, and submit their own answers.

## Run it

```
npm run setup     # first time only
npm start         # builds the UI and serves everything on port 3001
```

Open http://localhost:3001 on the host computer (ideally on a TV or projector).
Players on the same Wi-Fi open the network address the lobby screen shows
(e.g. http://192.168.x.x:3001) and type the 5-letter code.

If phones can't connect, allow Node.js through Windows Firewall on private networks.

### Developing

Run `npm run dev:server` and `npm run dev:client` in two terminals and open
http://localhost:5173. Vite forwards API and socket traffic to the server.

## How a game works

1. **Host → build a board.** Click a tile to write its clue, points, answer and
   answer mode. Boards auto-save as a draft in the browser; **Save** stores them
   on the server in `server/boards/` so they can be loaded again.
2. **Start game** shows a big code. Players join, then choose **Solo** or
   **Team** (the first teammate creates a team name, the second taps it).
3. The host picks tiles. Each question uses one of three answer modes:
   - **Typed answer**: everyone types; answers are auto-graded with typo
     tolerance (and the "also accept" list), then the host can flip any verdict
     before awarding points.
   - **Buzzer**: first to buzz types an answer and the host judges it. A wrong
     answer reopens the buzzer for everyone else.
   - **Crowd vote**: open-ended; everyone answers, then votes for the best
     answer (not their own). Most votes wins the points.
4. The host can nudge scores with +/− on the scoreboard and end the game any
   time. The game ends automatically when every tile is played.

Refreshing a page rejoins the same game. Games live in server memory, so
restarting the server ends them.
