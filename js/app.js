(function () {
  'use strict';

  const app = document.getElementById('app');
  const MIN_PLAYERS = 3;
  const MAX_PLAYERS = 20;
  const GAME_SCREENS = ['reveal', 'discuss', 'vote', 'verdict', 'guess', 'result'];

  // ---------- Storage (everything lives in the browser) ----------

  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem('imposter:' + key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem('imposter:' + key, JSON.stringify(value));
      } catch (e) {
        // Storage full or blocked – the game still works for this session.
      }
    },
    remove(key) {
      try {
        localStorage.removeItem('imposter:' + key);
      } catch (e) {
        // ignore
      }
    },
  };

  // ---------- Helpers ----------

  function randInt(max) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] % max;
  }

  function shuffle(list) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = randInt(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Czech plural: 1 hráč, 2–4 hráči, 5+ hráčů.
  function plural(n, one, few, many) {
    if (n === 1) return one;
    if (n >= 2 && n <= 4) return few;
    return many;
  }

  function esc(value) {
    return String(value).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function formatTime(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
  }

  const ICONS = {
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    back: '<path d="m15 18-6-6 6-6"/>',
    help: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
    trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4Z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
  };

  function icon(name) {
    return '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + '</svg>';
  }

  const LOGO = '<svg viewBox="0 0 512 512" aria-hidden="true"><rect width="512" height="512" rx="112" fill="#5121e4"/>' +
    '<path d="M96 248C96 158 164 88 256 88S416 158 416 248V424L376 392 336 424 296 392 256 424 216 392 176 424 136 392 96 424Z" fill="#fff"/>' +
    '<ellipse cx="206" cy="246" rx="28" ry="38" fill="#1a0b4d"/><ellipse cx="306" cy="246" rx="28" ry="38" fill="#ff4d6d"/></svg>';

  // ---------- State ----------

  const DEFAULT_SETTINGS = {
    players: ['', '', '', ''],
    imposters: 1,
    categories: null, // null = all built-in categories
    hint: 'category',
    timer: 180,
  };

  let settings = Object.assign({}, DEFAULT_SETTINGS, store.get('settings', {}));
  if (!Array.isArray(settings.players) || settings.players.length < MIN_PLAYERS) {
    settings.players = DEFAULT_SETTINGS.players.slice();
  }
  let customCategories = store.get('custom', []);
  let scores = store.get('scores', {});
  let usedWords = store.get('used', []);
  let screen = 'setup';
  let game = null;

  // Resume a game interrupted by a reload or a locked phone.
  const savedGame = store.get('game', null);
  if (savedGame && savedGame.game && GAME_SCREENS.includes(savedGame.screen)) {
    game = savedGame.game;
    screen = savedGame.screen;
  }

  function saveSettings() {
    store.set('settings', settings);
  }

  function saveCustom() {
    store.set('custom', customCategories);
  }

  function persistGame() {
    if (game) store.set('game', { screen, game });
    else store.remove('game');
  }

  // ---------- Categories & words ----------

  function parseCustomWords(text) {
    const seen = new Set();
    const words = [];
    for (const line of String(text).split('\n')) {
      const [word, ...rest] = line.split(';');
      const w = word.trim();
      if (!w || seen.has(w.toLowerCase())) continue;
      seen.add(w.toLowerCase());
      words.push([w, rest.join(';').trim()]);
    }
    return words;
  }

  function allCategories() {
    const custom = customCategories.map((c) => ({
      id: c.id,
      name: c.name.trim() || 'Bez názvu',
      icon: '✏️',
      words: parseCustomWords(c.text),
    }));
    return window.WORD_BANK.concat(custom);
  }

  function selectedCategoryIds() {
    if (!Array.isArray(settings.categories)) return window.WORD_BANK.map((c) => c.id);
    const known = new Set(allCategories().map((c) => c.id));
    return settings.categories.filter((id) => known.has(id));
  }

  function activeCategories() {
    const selected = new Set(selectedCategoryIds());
    return allCategories().filter((c) => selected.has(c.id) && c.words.length);
  }

  function pickWord(categories) {
    const pool = [];
    for (const cat of categories) {
      for (const [word, hint] of cat.words) {
        pool.push({ key: cat.id + '|' + word, word, hint, category: cat.name });
      }
    }
    const used = new Set(usedWords);
    let fresh = pool.filter((item) => !used.has(item.key));
    if (!fresh.length) {
      // Every word in the selection has been played – start over.
      const keys = new Set(pool.map((item) => item.key));
      usedWords = usedWords.filter((key) => !keys.has(key));
      fresh = pool;
    }
    const pick = fresh[randInt(fresh.length)];
    usedWords.push(pick.key);
    if (usedWords.length > 3000) usedWords = usedWords.slice(-3000);
    store.set('used', usedWords);
    return pick;
  }

  // ---------- Players ----------

  function playerName(i) {
    return (settings.players[i] || '').trim() || 'Hráč ' + (i + 1);
  }

  function maxImposters(count) {
    return Math.max(1, Math.floor((count - 1) / 2));
  }

  function clampImposters() {
    settings.imposters = Math.min(Math.max(1, settings.imposters), maxImposters(settings.players.length));
  }

  function setupProblem() {
    if (settings.players.length < MIN_PLAYERS) return 'Hrají alespoň 3 hráči.';
    const names = settings.players.map((_, i) => playerName(i).toLowerCase());
    if (new Set(names).size !== names.length) return 'Jména hráčů se nesmí opakovat.';
    if (!selectedCategoryIds().length) return 'Vyberte alespoň jednu kategorii.';
    if (!activeCategories().length) return 'Vybrané kategorie neobsahují žádná slova.';
    return '';
  }

  // ---------- Game ----------

  function newTimer() {
    const ms = settings.timer * 1000;
    return { total: ms, remaining: ms, endsAt: null, done: false };
  }

  function activePlayers() {
    return game.players.map((_, i) => i).filter((i) => !game.eliminated.includes(i));
  }

  function remainingImposters() {
    return game.imposters.filter((i) => !game.eliminated.includes(i));
  }

  function speakingOrder() {
    const n = game.players.length;
    const order = [];
    for (let k = 0; k < n; k++) {
      const i = (game.starter + k) % n;
      if (!game.eliminated.includes(i)) order.push(i);
    }
    return order;
  }

  function startGame() {
    if (setupProblem()) return render();
    const players = settings.players.map((_, i) => playerName(i));
    const count = Math.min(settings.imposters, maxImposters(players.length));
    const pick = pickWord(activeCategories());
    const useHint = settings.hint === 'hint' && pick.hint;
    game = {
      players,
      imposters: shuffle(players.map((_, i) => i)).slice(0, count).sort((a, b) => a - b),
      word: pick.word,
      category: pick.category,
      hint: settings.hint === 'none' ? '' : useHint ? pick.hint : pick.category,
      hintLabel: useHint ? 'Nápověda' : 'Kategorie',
      revealIndex: 0,
      round: 1,
      starter: randInt(players.length),
      eliminated: [],
      selected: null,
      accused: null,
      timer: newTimer(),
      outcome: null,
    };
    requestWakeLock();
    go('reveal');
  }

  function finish(winner, reason) {
    const points = {};
    game.players.forEach((name, i) => {
      const isImposter = game.imposters.includes(i);
      if (winner === 'crew' && !isImposter) points[name] = 1;
      if (winner === 'imposters' && isImposter) points[name] = 2;
    });
    for (const [name, p] of Object.entries(points)) scores[name] = (scores[name] || 0) + p;
    store.set('scores', scores);
    game.outcome = { winner, reason, points };
    go('result');
  }

  function endGame() {
    game = null;
    releaseWakeLock();
    go('setup');
  }

  // ---------- Timer ----------

  let audioCtx = null;

  function ensureAudio() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) {
      audioCtx = null;
    }
  }

  function alarm() {
    if (navigator.vibrate) navigator.vibrate([300, 120, 300, 120, 300]);
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    [0, 0.35, 0.7].forEach((offset) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.3, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.25);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.3);
    });
  }

  function timerLeft(t) {
    return t.endsAt ? Math.max(0, t.endsAt - Date.now()) : t.remaining;
  }

  function updateTimer() {
    const el = document.getElementById('timer');
    if (!el || !game) return;
    const t = game.timer;
    let left = timerLeft(t);
    if (t.endsAt && left <= 0) {
      t.endsAt = null;
      t.remaining = 0;
      t.done = true;
      left = 0;
      persistGame();
      alarm();
    }
    const running = Boolean(t.endsAt);
    el.querySelector('.progress').style.strokeDashoffset = String(100 - (left / t.total) * 100);
    el.querySelector('.timer-text').textContent = t.done ? 'Čas!' : formatTime(left);
    el.querySelector('.timer-state').textContent =
      t.done ? 'Čas vypršel' : running ? 'Pozastavit' : left === t.total ? 'Spustit' : 'Pokračovat';
    el.classList.toggle('running', running);
    el.classList.toggle('done', t.done);
    el.classList.toggle('warning', running && left <= 10000);
  }

  setInterval(() => {
    if (screen === 'discuss' && game && game.timer.total) updateTimer();
  }, 200);

  // ---------- Wake lock (keep the screen on while playing) ----------

  let wakeLock = null;

  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator && !wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      }
    } catch (e) {
      // Not supported or denied – nothing to do.
    }
  }

  function releaseWakeLock() {
    if (wakeLock) wakeLock.release().catch(() => {});
    wakeLock = null;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && game) requestWakeLock();
  });

  // ---------- Rendering ----------

  function go(next) {
    screen = next;
    render();
    window.scrollTo(0, 0);
  }

  function render() {
    app.innerHTML = (screens[screen] || screens.setup)();
    persistGame();
    if (screen === 'discuss') updateTimer();
    if (screen === 'verdict') {
      const parts = app.querySelectorAll('.verdict, .footer.late');
      setTimeout(() => parts.forEach((el) => el.classList.add('revealed')), 1200);
    }
  }

  function gameBar(title, extra) {
    return `
      <header class="bar">
        <span class="bar-title">${title}</span>
        ${extra || ''}
        <button class="icon-btn subtle" data-action="quit" aria-label="Ukončit hru">${icon('x')}</button>
      </header>`;
  }

  function pageBar(title) {
    return `
      <header class="bar">
        <button class="icon-btn" data-action="go" data-to="setup" aria-label="Zpět">${icon('back')}</button>
        <h1 class="bar-title">${title}</h1>
      </header>`;
  }

  function segmented(action, options, current) {
    return `<div class="segmented" role="group">${options.map(([value, label]) => {
      const on = String(value) === String(current);
      return `<button class="${on ? 'on' : ''}" data-action="${action}" data-value="${value}" aria-pressed="${on}">${label}</button>`;
    }).join('')}</div>`;
  }

  function setupFooter() {
    const problem = setupProblem();
    return `
      ${problem ? `<p class="warning">${problem}</p>` : ''}
      <button class="btn primary big full" data-action="start" ${problem ? 'disabled' : ''}>Začít hru</button>`;
  }

  const HINT_INFO = {
    none: 'Imposter neví vůbec nic. Pro zkušené hráče.',
    category: 'Imposter uvidí kategorii tajného slova.',
    hint: 'Imposter dostane slovo, které s tajným slovem volně souvisí.',
  };

  const screens = {
    setup() {
      const cats = allCategories();
      const selected = new Set(selectedCategoryIds());
      const n = settings.players.length;
      const maxImp = maxImposters(n);
      const imp = Math.min(settings.imposters, maxImp);
      const wordCount = cats.filter((c) => selected.has(c.id)).reduce((sum, c) => sum + c.words.length, 0);
      return `
        <header class="hero">
          <div class="hero-logo">${LOGO}</div>
          <div>
            <h1>Imposter</h1>
            <p class="muted">Kdo z vás nezná tajné slovo?</p>
          </div>
          <div class="hero-actions">
            <button class="icon-btn" data-action="go" data-to="scores" aria-label="Skóre">${icon('trophy')}</button>
            <button class="icon-btn" data-action="go" data-to="rules" aria-label="Jak hrát">${icon('help')}</button>
          </div>
        </header>

        <section class="card">
          <div class="card-head"><h2>Hráči</h2><span class="pill">${n}</span></div>
          <ol class="players">
            ${settings.players.map((name, i) => `
              <li class="player-row">
                <span class="player-num">${i + 1}</span>
                <input class="input" type="text" value="${esc(name)}" placeholder="Hráč ${i + 1}" data-player="${i}"
                  maxlength="24" autocomplete="off" autocapitalize="words" enterkeyhint="next" aria-label="Jméno hráče ${i + 1}">
                <button class="icon-btn subtle" data-action="remove-player" data-index="${i}" aria-label="Odebrat hráče"
                  ${n <= MIN_PLAYERS ? 'disabled' : ''}>${icon('x')}</button>
              </li>`).join('')}
          </ol>
          <button class="btn ghost full" data-action="add-player" ${n >= MAX_PLAYERS ? 'disabled' : ''}>${icon('plus')} Přidat hráče</button>
          <p class="hint">Zadejte hráče v pořadí, v jakém sedíte.</p>
        </section>

        <section class="card">
          <div class="card-head">
            <div>
              <h2>Počet imposterů</h2>
              <p class="hint">Nejvýše ${maxImp} pro ${n} ${plural(n, 'hráče', 'hráče', 'hráčů')}</p>
            </div>
            <div class="stepper">
              <button class="icon-btn" data-action="imposters" data-delta="-1" aria-label="Méně" ${imp <= 1 ? 'disabled' : ''}>${icon('minus')}</button>
              <output>${imp}</output>
              <button class="icon-btn" data-action="imposters" data-delta="1" aria-label="Více" ${imp >= maxImp ? 'disabled' : ''}>${icon('plus')}</button>
            </div>
          </div>
        </section>

        <section class="card">
          <div class="card-head">
            <h2>Kategorie</h2>
            <span class="muted small">${wordCount} ${plural(wordCount, 'slovo', 'slova', 'slov')}</span>
          </div>
          <div class="chips">
            ${cats.map((c) => {
              const on = selected.has(c.id);
              return `<button class="chip ${on ? 'on' : ''}" data-action="toggle-category" data-id="${esc(c.id)}" aria-pressed="${on}">
                <span aria-hidden="true">${c.icon}</span>${esc(c.name)}</button>`;
            }).join('')}
          </div>
          <div class="row-wrap">
            <button class="btn small ghost" data-action="all-categories">Vybrat vše</button>
            <button class="btn small ghost" data-action="no-categories">Zrušit výběr</button>
            <button class="btn small ghost" data-action="go" data-to="custom">${icon('edit')} Vlastní slova</button>
          </div>
        </section>

        <section class="card">
          <h2>Nápověda pro impostera</h2>
          ${segmented('set-hint', [['none', 'Žádná'], ['category', 'Kategorie'], ['hint', 'Nápověda']], settings.hint)}
          <p class="hint">${HINT_INFO[settings.hint]}</p>
        </section>

        <section class="card">
          <h2>Čas na diskuzi</h2>
          ${segmented('set-timer', [[0, 'Vyp.'], [60, '1 min'], [120, '2 min'], [180, '3 min'], [300, '5 min']], settings.timer)}
        </section>

        <div class="footer" id="setup-footer">${setupFooter()}</div>`;
    },

    reveal() {
      const i = game.revealIndex;
      const n = game.players.length;
      const isImposter = game.imposters.includes(i);
      const last = i === n - 1;
      const impCount = game.imposters.length;
      const back = isImposter ? `
        <span class="label">Tvoje role</span>
        <strong class="word">Imposter</strong>
        <span class="detail">${game.hint ? `${game.hintLabel}: <b>${esc(game.hint)}</b>` : 'Nemáš žádnou nápovědu.'}</span>
        <span class="muted small">${impCount > 1 ? `Imposterů je ve hře celkem ${impCount}. ` : ''}Nenech se odhalit a zkus uhodnout tajné slovo.</span>
      ` : `
        <span class="label">Tajné slovo</span>
        <strong class="word ${game.word.length > 14 ? 'long' : ''}">${esc(game.word)}</strong>
        <span class="detail">Kategorie: <b>${esc(game.category)}</b></span>
        <span class="muted small">Neříkej ho přímo – imposter poslouchá.</span>
      `;
      return `
        ${gameBar('Rozdávání rolí', `<span class="pill">${i + 1} / ${n}</span>`)}
        <div class="stage">
          <p class="muted">Na řadě je</p>
          <h2 class="name-big">${esc(game.players[i])}</h2>
          <button class="flip" data-action="flip" aria-label="Zobrazit nebo skrýt roli">
            <span class="flip-inner">
              <span class="face front">
                ${icon('eye')}
                <strong>Klepni a zobraz svou roli</strong>
                <span class="small">Ujisti se, že se nikdo nedívá.</span>
              </span>
              <span class="face back ${isImposter ? 'imposter' : 'crew'}">${back}</span>
            </span>
          </button>
        </div>
        <div class="footer">
          <button class="btn primary big full" data-action="next-player" disabled>
            ${last ? 'Skrýt a začít diskuzi' : 'Skrýt a předat dál'}
          </button>
        </div>`;
    },

    discuss() {
      const order = speakingOrder();
      const t = game.timer;
      return `
        ${gameBar(game.round > 1 ? `Diskuze · ${game.round}. kolo` : 'Diskuze')}
        <div class="stage">
          <p class="muted">Začíná</p>
          <h2 class="name-big">${esc(game.players[order[0]])}</h2>
          <ol class="order">${order.map((i, k) => `<li class="${k === 0 ? 'first' : ''}">${esc(game.players[i])}</li>`).join('')}</ol>
          ${t.total ? `
            <button class="timer" id="timer" data-action="timer-toggle" aria-label="Spustit nebo pozastavit časovač">
              <svg viewBox="0 0 120 120" class="timer-ring" aria-hidden="true">
                <circle cx="60" cy="60" r="54" class="track"/>
                <circle cx="60" cy="60" r="54" class="progress" pathLength="100"/>
              </svg>
              <span class="timer-face">
                <span class="timer-text">${formatTime(timerLeft(t))}</span>
                <span class="timer-state"></span>
              </span>
            </button>
            <div class="row-wrap center">
              <button class="btn small ghost" data-action="timer-add">+30 s</button>
              <button class="btn small ghost" data-action="timer-reset">${icon('reset')} Znovu</button>
            </div>` : ''}
          <p class="hint">Každý řekne jedno slovo nebo krátkou větu k tajnému slovu. Nebuďte moc konkrétní – imposter poslouchá!</p>
        </div>
        <div class="footer">
          <button class="btn primary big full" data-action="go" data-to="vote">Hlasovat</button>
        </div>`;
    },

    vote() {
      const sel = game.selected;
      return `
        ${gameBar('Hlasování')}
        <div class="stage">
          <h2 class="title">Koho obviníte?</h2>
          <p class="muted">Domluvte se nebo hlasujte zvednutím ruky a vyberte, kdo je podle vás imposter.</p>
          <div class="vote-list">
            ${activePlayers().map((i) => `
              <button class="vote ${sel === i ? 'on' : ''}" data-action="select-suspect" data-index="${i}" aria-pressed="${sel === i}">
                ${esc(game.players[i])}
              </button>`).join('')}
          </div>
        </div>
        <div class="footer">
          <button class="btn danger big full" data-action="accuse" ${sel == null ? 'disabled' : ''}>
            ${sel == null ? 'Vyberte podezřelého' : 'Obvinit: ' + esc(game.players[sel])}
          </button>
          <button class="btn ghost full" data-action="go" data-to="discuss">Zpět k diskuzi</button>
        </div>`;
    },

    verdict() {
      const caught = game.imposters.includes(game.accused);
      const left = remainingImposters().length;
      const multiple = game.imposters.length > 1;
      let text;
      let action;
      if (!caught) {
        text = multiple ? 'Obvinili jste nevinného. Tím vyhrávají imposteři.' : 'Obvinili jste nevinného. Tím vyhrává imposter.';
        action = '<button class="btn primary big full" data-action="imposters-win">Výsledky</button>';
      } else if (left > 0) {
        text = `Dobrá práce! Ve hře ale ${plural(left, 'zbývá', 'zbývají', 'zbývá')} ještě ${left} ${plural(left, 'imposter', 'imposteři', 'imposterů')}.`;
        action = '<button class="btn primary big full" data-action="continue-discussion">Pokračovat v diskuzi</button>';
      } else {
        text = multiple
          ? 'Všichni imposteři jsou odhaleni! Teď mají poslední šanci uhodnout tajné slovo.'
          : 'Imposter je odhalen! Teď má poslední šanci uhodnout tajné slovo.';
        action = '<button class="btn primary big full" data-action="go" data-to="guess">Poslední šance</button>';
      }
      return `
        ${gameBar('Verdikt')}
        <div class="stage verdict ${caught ? 'caught' : 'innocent'}">
          <p class="suspense">Odhalujeme…</p>
          <div class="verdict-body">
            <h2 class="name-big">${esc(game.players[game.accused])}</h2>
            <p class="verdict-tag">${caught ? 'je imposter!' : 'není imposter'}</p>
            <p>${text}</p>
          </div>
        </div>
        <div class="footer late">${action}</div>`;
    },

    guess() {
      const names = game.imposters.map((i) => game.players[i]);
      const multiple = names.length > 1;
      return `
        ${gameBar('Poslední šance')}
        <div class="stage">
          <h2 class="title">${esc(names.join(', '))}</h2>
          <p class="muted">${multiple
            ? 'Řekněte nahlas, jaké je podle vás tajné slovo. Máte jeden společný pokus.'
            : 'Řekni nahlas, jaké je podle tebe tajné slovo. Máš jeden pokus.'}</p>
          <button class="secret" data-action="show-secret">
            <span class="secret-cover">${icon('eye')} Klepněte pro odhalení tajného slova</span>
            <span class="secret-word">${esc(game.word)}</span>
          </button>
        </div>
        <div class="footer guess-actions" hidden>
          <p class="muted center">Uhodl imposter tajné slovo?</p>
          <div class="row-2">
            <button class="btn danger big" data-action="guess-right">${icon('check')} Ano</button>
            <button class="btn success big" data-action="guess-wrong">${icon('x')} Ne</button>
          </div>
        </div>`;
    },

    result() {
      const { winner, reason, points } = game.outcome;
      const crewWon = winner === 'crew';
      const multiple = game.imposters.length > 1;
      const reasons = {
        caught: multiple ? 'Všichni imposteři byli odhaleni a tajné slovo neuhodli.' : 'Imposter byl odhalen a tajné slovo neuhodl.',
        innocent: 'Posádka obvinila nevinného hráče.',
        guessed: multiple ? 'Imposteři byli odhaleni, ale uhodli tajné slovo.' : 'Imposter byl odhalen, ale uhodl tajné slovo.',
      };
      const title = crewWon ? 'Vyhrála posádka!' : multiple ? 'Vyhráli imposteři!' : 'Vyhrál imposter!';
      const ranking = game.players
        .map((name) => [name, scores[name] || 0])
        .sort((a, b) => b[1] - a[1]);
      return `
        <div class="result-hero ${crewWon ? 'crew' : 'imposter'}">
          <p class="label">Konec kola</p>
          <h1>${title}</h1>
          <p>${reasons[reason]}</p>
        </div>

        <section class="card">
          <div class="kv"><span class="muted">Tajné slovo</span><strong>${esc(game.word)}</strong></div>
          <div class="kv"><span class="muted">Kategorie</span><span>${esc(game.category)}</span></div>
          <div class="kv"><span class="muted">${multiple ? 'Imposteři' : 'Imposter'}</span>
            <strong class="text-danger">${esc(game.imposters.map((i) => game.players[i]).join(', '))}</strong></div>
        </section>

        <section class="card">
          <h2>Skóre</h2>
          <ol class="scores">
            ${ranking.map(([name, total], k) => `
              <li>
                <span class="player-num">${k + 1}</span>
                <span class="score-name">${esc(name)}</span>
                <span class="gain">${points[name] ? '+' + points[name] : ''}</span>
                <span class="total">${total}</span>
              </li>`).join('')}
          </ol>
        </section>

        <div class="footer">
          <button class="btn primary big full" data-action="start">Další kolo</button>
          <button class="btn ghost full" data-action="to-setup">Upravit nastavení</button>
        </div>`;
    },

    scores() {
      const ranking = Object.entries(scores).sort((a, b) => b[1] - a[1]);
      return `
        ${pageBar('Celkové skóre')}
        <section class="card">
          ${ranking.length ? `
            <ol class="scores">
              ${ranking.map(([name, total], k) => `
                <li>
                  <span class="player-num">${k + 1}</span>
                  <span class="score-name">${esc(name)}</span>
                  <span></span>
                  <span class="total">${total}</span>
                </li>`).join('')}
            </ol>` : '<p class="muted center">Zatím nikdo nemá žádné body. Odehrajte první kolo!</p>'}
          <p class="hint">Výhra posádky: +1 bod každému nevinnému. Výhra imposterů: +2 body každému imposterovi.</p>
        </section>
        ${ranking.length ? `<button class="btn ghost full" data-action="reset-scores">${icon('trash')} Vynulovat skóre</button>` : ''}`;
    },

    rules() {
      return `
        ${pageBar('Jak hrát')}
        <section class="card prose">
          <ol>
            <li><b>Nastavte hru.</b> Zadejte jména hráčů v pořadí, v jakém sedíte, vyberte kategorie a počet imposterů.</li>
            <li><b>Rozdejte role.</b> Telefon koluje dokola a každý si v soukromí zobrazí svou kartu. Všichni dostanou stejné tajné slovo – kromě imposterů, kteří ho neznají.</li>
            <li><b>Diskutujte.</b> Počínaje vylosovaným hráčem řekne každý jedno slovo nebo krátkou větu, která s tajným slovem souvisí. Nebuďte příliš konkrétní, ať imposter slovo neuhodne.</li>
            <li><b>Blafujte.</b> Imposter slovo nezná, a tak musí pozorně poslouchat ostatní a nenápadně zapadnout.</li>
            <li><b>Hlasujte.</b> Až budete připraveni, společně vyberte, koho obviníte.</li>
          </ol>
        </section>
        <section class="card prose">
          <h2>Kdo vyhrává?</h2>
          <ul>
            <li>Pokud obviníte nevinného hráče, vyhrávají imposteři.</li>
            <li>Pokud odhalíte impostera a ve hře jich je víc, diskuze pokračuje dalším kolem.</li>
            <li>Když odhalíte všechny impostery, mají poslední šanci uhodnout tajné slovo. Pokud se jim to povede, vyhrávají oni, jinak vyhrává posádka.</li>
          </ul>
          <h2>Body</h2>
          <ul>
            <li>Výhra posádky: <b>+1 bod</b> každému nevinnému hráči.</li>
            <li>Výhra imposterů: <b>+2 body</b> každému imposterovi.</li>
          </ul>
        </section>`;
    },

    custom() {
      return `
        ${pageBar('Vlastní slova')}
        <p class="muted">Vytvořte si vlastní kategorie. Každé slovo napište na samostatný řádek, nápovědu pro impostera můžete přidat za středník.</p>
        <pre class="example">Pizza; těsto
Svíčková; omáčka</pre>
        ${customCategories.length ? '' : '<p class="muted center">Zatím nemáte žádnou vlastní kategorii.</p>'}
        ${customCategories.map((c) => {
          const count = parseCustomWords(c.text).length;
          return `
            <section class="card">
              <div class="row">
                <input class="input" type="text" data-custom-name="${c.id}" value="${esc(c.name)}" placeholder="Název kategorie" maxlength="32">
                <button class="icon-btn subtle" data-action="delete-custom" data-id="${c.id}" aria-label="Smazat kategorii">${icon('trash')}</button>
              </div>
              <textarea class="input" data-custom-text="${c.id}" rows="8" placeholder="Jedno slovo na řádek">${esc(c.text)}</textarea>
              <p class="hint" data-custom-count="${c.id}">${count} ${plural(count, 'slovo', 'slova', 'slov')}</p>
            </section>`;
        }).join('')}
        <button class="btn ghost full" data-action="add-custom">${icon('plus')} Nová kategorie</button>
        <div class="footer">
          <button class="btn primary big full" data-action="go" data-to="setup">Hotovo</button>
        </div>`;
    },
  };

  // ---------- Actions ----------

  const actions = {
    go(el) {
      go(el.dataset.to);
    },

    'add-player'() {
      settings.players.push('');
      clampImposters();
      saveSettings();
      render();
      const inputs = app.querySelectorAll('[data-player]');
      inputs[inputs.length - 1].focus();
    },

    'remove-player'(el) {
      settings.players.splice(Number(el.dataset.index), 1);
      clampImposters();
      saveSettings();
      render();
    },

    imposters(el) {
      settings.imposters += Number(el.dataset.delta);
      clampImposters();
      saveSettings();
      render();
    },

    'toggle-category'(el) {
      const ids = selectedCategoryIds();
      const id = el.dataset.id;
      settings.categories = ids.includes(id) ? ids.filter((x) => x !== id) : ids.concat(id);
      saveSettings();
      render();
    },

    'all-categories'() {
      settings.categories = allCategories().map((c) => c.id);
      saveSettings();
      render();
    },

    'no-categories'() {
      settings.categories = [];
      saveSettings();
      render();
    },

    'set-hint'(el) {
      settings.hint = el.dataset.value;
      saveSettings();
      render();
    },

    'set-timer'(el) {
      settings.timer = Number(el.dataset.value);
      saveSettings();
      render();
    },

    start: startGame,

    quit() {
      if (confirm('Opravdu ukončit rozehranou hru?')) endGame();
    },

    flip(el) {
      el.classList.toggle('is-flipped');
      app.querySelector('[data-action="next-player"]').disabled = false;
    },

    'next-player'() {
      if (game.revealIndex < game.players.length - 1) {
        game.revealIndex++;
        render();
      } else {
        go('discuss');
      }
    },

    'timer-toggle'() {
      const t = game.timer;
      ensureAudio();
      if (t.done) return;
      if (t.endsAt) {
        t.remaining = timerLeft(t);
        t.endsAt = null;
      } else {
        t.endsAt = Date.now() + t.remaining;
      }
      persistGame();
      updateTimer();
    },

    'timer-add'() {
      const t = game.timer;
      if (t.done) {
        t.done = false;
        t.endsAt = Date.now() + 30000;
      } else if (t.endsAt) {
        t.endsAt += 30000;
      } else {
        t.remaining += 30000;
      }
      t.total = Math.max(t.total, timerLeft(t));
      persistGame();
      updateTimer();
    },

    'timer-reset'() {
      game.timer = newTimer();
      persistGame();
      updateTimer();
    },

    'select-suspect'(el) {
      game.selected = Number(el.dataset.index);
      render();
    },

    accuse() {
      game.accused = game.selected;
      game.eliminated.push(game.selected);
      game.selected = null;
      go('verdict');
    },

    'continue-discussion'() {
      const active = activePlayers();
      game.round++;
      game.starter = active[randInt(active.length)];
      game.timer = newTimer();
      go('discuss');
    },

    'imposters-win'() {
      finish('imposters', 'innocent');
    },

    'show-secret'(el) {
      el.classList.add('shown');
      app.querySelector('.guess-actions').hidden = false;
    },

    'guess-right'() {
      finish('imposters', 'guessed');
    },

    'guess-wrong'() {
      finish('crew', 'caught');
    },

    'to-setup'() {
      endGame();
    },

    'reset-scores'() {
      if (!confirm('Opravdu vynulovat skóre všech hráčů?')) return;
      scores = {};
      store.set('scores', scores);
      render();
    },

    'add-custom'() {
      const id = 'custom-' + Date.now().toString(36);
      customCategories.push({ id, name: '', text: '' });
      saveCustom();
      settings.categories = selectedCategoryIds().concat(id);
      saveSettings();
      render();
      const input = app.querySelector(`[data-custom-name="${id}"]`);
      if (input) input.focus();
    },

    'delete-custom'(el) {
      const cat = customCategories.find((c) => c.id === el.dataset.id);
      if (!cat || !confirm(`Smazat kategorii „${cat.name.trim() || 'Bez názvu'}“?`)) return;
      customCategories = customCategories.filter((c) => c !== cat);
      saveCustom();
      if (Array.isArray(settings.categories)) {
        settings.categories = settings.categories.filter((id) => id !== cat.id);
        saveSettings();
      }
      render();
    },
  };

  app.addEventListener('click', (event) => {
    const el = event.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const action = actions[el.dataset.action];
    if (action) action(el, event);
  });

  app.addEventListener('input', (event) => {
    const el = event.target;
    if (el.dataset.player != null) {
      settings.players[Number(el.dataset.player)] = el.value;
      saveSettings();
      const footer = document.getElementById('setup-footer');
      if (footer) footer.innerHTML = setupFooter();
      return;
    }
    const id = el.dataset.customName || el.dataset.customText;
    const cat = id && customCategories.find((c) => c.id === id);
    if (!cat) return;
    if (el.dataset.customName) {
      cat.name = el.value;
    } else {
      cat.text = el.value;
      const count = parseCustomWords(cat.text).length;
      app.querySelector(`[data-custom-count="${id}"]`).textContent = `${count} ${plural(count, 'slovo', 'slova', 'slov')}`;
    }
    saveCustom();
  });

  // Enter in a player name jumps to the next name.
  app.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.target.dataset.player == null) return;
    event.preventDefault();
    const next = app.querySelector(`[data-player="${Number(event.target.dataset.player) + 1}"]`);
    if (next) next.focus();
    else event.target.blur();
  });

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  if (game) requestWakeLock();
  render();
})();
