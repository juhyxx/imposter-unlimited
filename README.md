# Imposter

A pass-and-play party word game for one phone, with a Czech UI. Everyone gets the same secret word except the imposter, who has to bluff their way through the discussion.

**Play:** https://juhyxx.github.io/imposter-unlimited/

- 3–20 players, multiple imposters
- ~490 Czech words in 15 categories, plus your own custom categories
- Imposter hint modes: none / category / related word
- Discussion timer, voting, last-chance word guess, scoreboard
- Everything (players, settings, custom words, scores, game in progress) is stored in the browser's `localStorage`
- Installable PWA, works offline

## Run locally

Plain HTML/CSS/JS, no build step and no backend. Open `index.html` directly, or serve the folder so the service worker works:

```sh
python3 -m http.server 8000
```

## Files

- `index.html`: app shell
- `js/app.js`: game logic and rendering
- `js/words.js`: word bank (`[word, hint]` pairs per category)
- `css/style.css`: styles
- `sw.js`, `manifest.webmanifest`, `icon*`: PWA
