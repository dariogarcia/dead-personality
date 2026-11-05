/* dead-personality app — DOM glue only. No network, no tracking. */
(function () {
  "use strict";

  var game = null;
  var gameSeed = 0;
  var history = []; // [{qid, option}]
  var currentQ = null;
  var lastSelectedId = null;

  // ---- i18n ---------------------------------------------------------------
  // English UI strings are the base; es/ca ship in DP_DATA.i18n (baked by the
  // build from data/i18n/*.json). Anything missing falls back to English.
  // Strings may contain {placeholders}; T(key, obj) interpolates them.
  var UI_EN = {
    title: "Find your dead soulmate",
    tagline: "Pull up a chair. Answer for yourself — and meet the dead who shared your tastes.",
    sideTitle: "Your soulmate, so far",
    mysteryQ: "Who's waiting to meet you?",
    mysteryHint: "Make yourself comfortable — after a few answers, your first kindred spirit appears here.",
    mysteryHint2: "{n} more answers and your first kindred spirit appears here.",
    alsoClose: "Others close to you",
    takeBack: "Take back last answer",
    startOver: "Start over",
    questionOf: "Question {n} of {max}",
    verdict: "You agree on",
    verdict2: "of the weighted preferences:",
    whatYouShare: "What you share",
    panelEvidence: "How your answers match",
    panelRemark: "Why they're remarkable",
    panelBooks: "Recommended reading",
    evBoth: "both: {a}",
    evSplit: "you: {a} · them: {b}",
    theirPick: "they'd say: {a}",
    inTheirWords: "In their own words",
    readAbout: "Read about them",
    booksNote: "Links open an external book search — nothing loads until you click.",
    otherKindred: "Other kindred spirits",
    meetSomeoneNew: "Start over — meet someone new",
    footer: "Static, offline, zero-request build. Book links go out only if you click them. Portraits are public-domain or Creative-Commons licensed images fetched at build time and shipped locally.",
    aboutTitle: "About this service",
    disclaimerShort: "Experimental free service from an internal BSC research project, largely built by open-source AI models on BSC infrastructure. Not an official BSC product — provided as-is, may contain errors.",
    disclaimerLink: "Full disclaimer",
    sourceLink: "Source & method on GitHub",
    agreementWord: "agreement",
    youBoth: "You both:",
    sideExplain: "Where {name} would have picked a side, your answers backed {pct} of that stake.",
    resultExplain: "{pct} means: of all the questions where {name} would pick a side — weighted by how strongly — your answers backed that share, and split from the rest. The list below shows exactly which answers drove the match.",
    openMatch: "Open this match",
    noBooks: "No books recorded.",
    chipsLegend: "plain chips: preferences you share · struck-through: where they leaned the other way · outlined: preferences that rule them out",
    noSignal: "no strong signal either way",
    dataMissing: "Data file missing — run: node tools/build.mjs",
    langLabel: "Language"
  };

  var LANG = "en";
  var LANGS = ["en", "es", "ca"];

  function detectLang() {
    try { return (localStorage.getItem("dp-lang")) || ""; } catch (e) { return ""; }
  }
  function pickInitialLang() {
    var saved = detectLang();
    if (LANGS.indexOf(saved) >= 0) return saved;
    var nav = (navigator.language || "en").toLowerCase();
    if (nav.indexOf("ca") === 0) return "ca";
    if (nav.indexOf("es") === 0) return "es";
    return "en";
  }

  function dict() {
    var i18n = (typeof DP_DATA !== "undefined" && DP_DATA.i18n) || {};
    return i18n[LANG] || {};
  }

  function T(key, vars) {
    var d = dict().ui, s = (d && d[key] !== undefined) ? d[key] : UI_EN[key];
    if (typeof s !== "string") return s;
    if (vars) {
      for (var v in vars) s = s.split("{" + v + "}").join(String(vars[v]));
    }
    return s;
  }

  function qLoc(q) {
    var m = dict().questions, e = m && m[q.id];
    if (e && e.t && e.o && e.o.length === 2) {
      return { text: e.t, o: [e.o[0], e.o[1]] };
    }
    return { text: q.text, o: [q.options[0].label, q.options[1].label] };
  }

  function blurbOf(p) {
    var m = dict().people;
    return (m && m[p.id]) || p.blurb;
  }

  function setLang(l) {
    LANG = l;
    try { localStorage.setItem("dp-lang", l); } catch (e) { /* file:// */ }
    document.documentElement.setAttribute("lang", l);
    renderStatic();
    updateLangButtons();
    if (game) {
      if (screens.quiz.hidden) renderResult(game.state(), lastSelectedId);
      else if (currentQ) renderQuiz(game.state());
    }
  }

  function updateLangButtons() {
    for (var i = 0; i < LANGS.length; i++) {
      var b = $("lang-" + LANGS[i]);
      if (b) b.className = (LANGS[i] === LANG) ? "active" : "";
    }
  }

  function renderStatic() {
    var nodes = document.querySelectorAll("[data-i18n]");
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].textContent = T(nodes[i].getAttribute("data-i18n"));
    }
    // full disclaimer ships in all three languages; show the active one
    var blocks = document.querySelectorAll("[data-about-lang]");
    for (var b = 0; b < blocks.length; b++) {
      blocks[b].hidden = (blocks[b].getAttribute("data-about-lang") !== LANG);
    }
    document.title = T("title");
  }

  // ---- helpers -------------------------------------------------------------
  var $ = function (id) { return document.getElementById(id); };
  var screens = {
    quiz: $("screen-quiz"), result: $("screen-result")
  };

  function show(name) {
    for (var k in screens) screens[k].hidden = (k !== name);
  }

  function monogramHue(id) {
    var h = 0;
    for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
    return h;
  }

  function initials(name) {
    var parts = name.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function bookUrl(book) {
    return "https://openlibrary.org/search?q=" +
      encodeURIComponent(book.t + " " + book.a);
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // Portrait from the baked manifest (fetched at build time from Wikimedia
  // Commons, public-domain/CC only, shipped locally). Falls back to a
  // monogram when a person has no usable portrait.
  function portraitEl(p, cls) {
    var pr = (typeof DP_DATA !== "undefined" && DP_DATA.portraits) || {};
    var rec = pr[p.id];
    if (rec && rec.src) {
      var img = document.createElement("img");
      img.className = cls;
      img.src = rec.src;
      img.alt = "";
      img.loading = "lazy";
      img.addEventListener("error", function () {
        var mono = monoEl(p, cls);
        img.parentNode.replaceChild(mono, img);
      });
      return img;
    }
    return monoEl(p, cls);
  }

  function monoEl(p, cls) {
    var mono = el("span", cls + " monogram");
    mono.textContent = initials(p.name);
    mono.style.background = "hsl(" + monogramHue(p.id) + ", 45%, 40%)";
    return mono;
  }

  function portraitCredit(p) {
    var pr = (typeof DP_DATA !== "undefined" && DP_DATA.portraits) || {};
    var rec = pr[p.id];
    if (!rec) return "";
    var artist = rec.artist ? String(rec.artist).replace(/<[^>]*>/g, "").trim() : "";
    var parts = [];
    if (artist) parts.push(artist.length > 60 ? artist.slice(0, 57) + "…" : artist);
    if (rec.license) parts.push(rec.license);
    return parts.join(" · ");
  }

  // ---- game flow -----------------------------------------------------------
  function newGame(seed) {
    return DPEngine.createGame({
      people: DP_DATA.people,
      questions: DP_DATA.questions,
      seed: seed,
      config: { fameK: DP_DATA.fameK }
    });
  }

  function startGame() {
    gameSeed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
    game = newGame(gameSeed);
    history = [];
    lastSelectedId = null;
    show("quiz");
    renderQuiz(game.state());
  }

  // Rebuild a game up to `history` with the same seed. Because the engine's
  // tie-breaks are pure functions of (seed, qid, asked-count), the rebuilt
  // game follows the exact same question sequence — take-back is lossless.
  function rebuild() {
    game = newGame(gameSeed);
    for (var i = 0; i < history.length; i++) {
      game.answer(history[i].qid, history[i].option);
    }
    return game.state();
  }

  // ---- side panel: the continuous match ------------------------------------
  // Before the third answer: a question-mark mystery card. After: the
  // current top match in large detail, others below, both clickable.
  function renderSide(st) {
    var ready = history.length >= 3;
    $("side-unknown").hidden = ready;
    $("side-match").hidden = !ready;
    if (!ready) {
      var left = 3 - history.length;
      $("mystery-hint").textContent = T("mysteryHint2", { n: left });
      return;
    }
    var top = st.top[0];
    if (!top) return;
    var p = top.person;

    var slot = $("side-photo-slot");
    slot.textContent = "";
    slot.appendChild(portraitEl(p, "side-photo"));

    $("side-name").textContent = p.name;
    $("side-meta").textContent = p.born + "–" + p.died + " · " + p.field;
    $("side-agreement").textContent = agreementPct(top.agreement) + " " + T("agreementWord");

    // top shared-preference tags as chips
    var shared = sharedTags(p, 3);
    $("side-shared").textContent = shared.length ? T("youBoth") + " " + shared.join(", ").replace(/-/g, " ") : "";

    $("side-explain").textContent = T("sideExplain", { name: p.name, pct: agreementPct(top.agreement) });

    // why-remarkable note + the two recommended books, prominent on the card
    $("side-blurb").textContent = blurbOf(p);
    var sb = $("side-books");
    sb.textContent = "";
    var booksList = (p.books || []).slice(0, 2);
    booksList.forEach(function (b) {
      var li = el("li");
      var a = document.createElement("a");
      a.href = bookUrl(b);
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = b.t;
      li.appendChild(a);
      li.appendChild(el("span", "by", " — " + b.a));
      sb.appendChild(li);
    });
    $("side-books-title").hidden = !booksList.length;

    // per-question evidence: where the featured person stood on each answer
    var ev = $("side-evidence");
    ev.textContent = "";
    var rec = game.receiptsFor(p);
    var shown = 0;
    for (var e = 0; e < rec.length && shown < 6; e++) {
      var rr = rec[e];
      if (rr.vote === null || rr.vote === undefined) continue; // no stake — skip
      var qd = null;
      for (var qi = 0; qi < DP_DATA.questions.length; qi++) {
        if (DP_DATA.questions[qi].id === rr.qid) { qd = DP_DATA.questions[qi]; break; }
      }
      if (!qd) continue;
      var loc = qLoc(qd);
      var li = el("li", rr.vote === rr.option ? "ev-hit" : "ev-miss");
      li.appendChild(el("span", "ev-mark", rr.vote === rr.option ? "✓" : "✗"));
      li.appendChild(el("span", "ev-q", loc.text));
      li.appendChild(el("span", "ev-a", rr.vote === rr.option
        ? T("evBoth", { a: loc.o[rr.option] })
        : T("evSplit", { a: loc.o[rr.option], b: loc.o[rr.vote] })));
      appendTopicQuote(li, p, rr.qid);
      ev.appendChild(li);
      shown++;
    }
    if (!shown) ev.appendChild(el("li", "ev-none", T("noSignal")));

    // attested quote supporting the person's documented character
    var sideQuote = $("side-quote");
    if (p.quote) {
      sideQuote.hidden = false;
      $("side-quote-text").textContent = "“" + p.quote + "”";
      $("side-quote-src").textContent = p.quoteSrc ? "— " + p.quoteSrc : "";
    } else {
      sideQuote.hidden = true;
    }

    var ol = $("side-others");
    ol.textContent = "";
    st.top.slice(1, 8).forEach(function (t) {
      var li = el("li");
      var btn = el("button", "alt-pick");
      btn.type = "button";
      btn.appendChild(el("strong", null, t.person.name));
      btn.appendChild(el("span", "alt-meta",
        " " + t.person.born + "–" + t.person.died + " · " + agreementPct(t.agreement)));
      btn.addEventListener("click", function () {
        renderResult(st, t.person.id);
      });
      li.appendChild(btn);
      ol.appendChild(li);
    });
  }

  // question-matched quote: if the person has a documented line about this
  // exact question's theme, show it right under the evidence receipt
  function appendTopicQuote(li, person, qid) {
    var tq = person.topicQuotes && person.topicQuotes[qid];
    if (!tq || !tq.q) return;
    var bq = el("blockquote", "ev-quote");
    bq.appendChild(el("span", "ev-quote-text", "“" + tq.q + "”"));
    if (tq.src) bq.appendChild(el("span", "ev-quote-src", "— " + tq.src));
    li.appendChild(bq);
  }

  function sharedTags(person, n) {
    var seen = {}, out = [];
    var rec = game.receiptsFor(person);
    for (var i = 0; i < rec.length && out.length < n; i++) {
      var m = rec[i].matched || [];
      for (var j = 0; j < m.length && out.length < n; j++) {
        if (!seen[m[j]]) { seen[m[j]] = true; out.push(m[j]); }
      }
    }
    return out;
  }

  function renderQuiz(st) {
    if (st.done || !st.next) { renderResult(st); return; }
    currentQ = st.next;
    $("q-count").textContent = T("questionOf", { n: st.asked + 1, max: st.maxQuestions });
    // moon-phase progress: past answers full, current half, ahead new
    var dots = $("q-dots");
    dots.textContent = "";
    for (var i = 0; i < st.maxQuestions; i++) {
      var phase = i < st.asked ? "\u25CF" : (i === st.asked ? "\u25D0" : "\u25CB");
      var cls = i < st.asked ? "on" : (i === st.asked ? "cur" : "");
      dots.appendChild(el("span", cls, phase));
    }
    var loc = qLoc(currentQ);
    $("q-text").textContent = loc.text;
    for (var o = 0; o < 2; o++) {
      var b = $("opt-" + o);
      b.textContent = loc.o[o];
      b.disabled = false;
    }
    $("btn-back").disabled = (history.length === 0);
    renderSide(st);
    $("opt-0").focus();
  }

  function answer(optIdx) {
    if (!game || !currentQ) return;
    history.push({ qid: currentQ.id, option: optIdx });
    var st = game.answer(currentQ.id, optIdx);
    currentQ = null;
    if (st.done || !st.next) { renderResult(st); }
    else { renderQuiz(st); }
  }

  function takeBack() {
    if (!history.length) return;
    history.pop();
    currentQ = null;
    renderQuiz(rebuild());
  }

  // top-1 side card is clickable too
  $("side-top").addEventListener("click", function () {
    if (!game) return;
    renderResult(game.state(), null);
  });

  // ---- result --------------------------------------------------------------
  function agreementPct(ag) {
    return ag === null || ag === undefined ? "—" : Math.round(ag * 100) + "%";
  }

  function renderMatchCard(p, ag) {
    var slot = $("photo-slot");
    slot.textContent = "";
    slot.appendChild(portraitEl(p, "portrait"));

    var credit = portraitCredit(p);
    var creditEl = $("portrait-credit");
    if (creditEl) creditEl.textContent = credit;

    $("agreement").textContent = agreementPct(ag);
    $("g-name").textContent = p.name;
    $("g-meta").textContent =
      p.born + "–" + p.died + " · " + p.field + " · " + p.place;
    $("g-blurb").textContent = blurbOf(p);

    var gQuote = $("g-quote");
    if (p.quote) {
      gQuote.hidden = false;
      $("g-quote-title").hidden = false;
      $("g-quote-text").textContent = "“" + p.quote + "”";
      $("g-quote-src").textContent = p.quoteSrc ? "— " + p.quoteSrc : "";
    } else {
      gQuote.hidden = true;
      $("g-quote-title").hidden = true;
    }
    $("g-explain").textContent = T("resultExplain", { name: p.name, pct: agreementPct(ag) });

    // receipts: what you share with this person (localized question text)
    var rec = game.receiptsFor(p);
    var ul = $("receipts");
    ul.textContent = "";
    rec.forEach(function (r) {
      var q = null;
      for (var i = 0; i < DP_DATA.questions.length; i++) {
        if (DP_DATA.questions[i].id === r.qid) { q = DP_DATA.questions[i]; break; }
      }
      var loc = q ? qLoc(q) : { text: r.question, o: [r.chosen, r.chosen] };
      var chosenLabel = r.chosen;
      if (q) {
        var ai = history.filter(function (h) { return h.qid === r.qid; })[0];
        if (ai) chosenLabel = loc.o[ai.option];
      }
      var li = el("li");
      if (r.vote !== null && r.vote !== undefined) {
        li.className = r.vote === r.option ? "ev-hit" : "ev-miss";
        li.appendChild(el("span", "ev-mark", r.vote === r.option ? "✓" : "✗"));
      }
      li.appendChild(el("span", "q", loc.text));
      li.appendChild(el("span", "a", "→ " + chosenLabel));
      if (q && r.vote !== null && r.vote !== undefined && r.vote !== r.option) {
        li.appendChild(el("span", "a their-vote", " · " + T("theirPick", { a: loc.o[r.vote] })));
      }
      r.matched.forEach(function (t) { li.appendChild(el("span", "chip", t)); });
      r.missed.forEach(function (t) { li.appendChild(el("span", "chip miss", t)); });
      r.dampened.forEach(function (t) { li.appendChild(el("span", "chip dampen", t)); });
      appendTopicQuote(li, p, r.qid);
      if (!r.matched.length && !r.missed.length && !r.dampened.length) {
        li.appendChild(el("span", "chip-note", T("noSignal")));
      }
      ul.appendChild(li);
    });
    var legend = el("li");
    legend.appendChild(el("span", "chip-note", T("chipsLegend")));
    ul.appendChild(legend);

    // books (click-only outbound links; covers stay out — publisher copyright)
    var bl = $("books");
    bl.textContent = "";
    (p.books || []).forEach(function (b) {
      var li = el("li");
      var a = document.createElement("a");
      a.href = bookUrl(b);
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = b.t;
      li.appendChild(a);
      li.appendChild(el("span", "by", " — " + b.a));
      bl.appendChild(li);
    });
    if (!bl.firstChild) bl.appendChild(el("li", null, T("noBooks")));
  }

  function renderAlternates(top, selectedId) {
    var alts = $("alternatives");
    alts.textContent = "";
    top.forEach(function (t) {
      if (t.person.id === selectedId) return;
      var li = el("li");
      var btn = el("button", "alt-pick");
      btn.type = "button";
      btn.appendChild(el("strong", null, t.person.name));
      btn.appendChild(el("span", "alt-meta",
        " " + t.person.born + "–" + t.person.died + " · " + t.person.field +
        " · " + agreementPct(t.agreement) + " " + T("agreementWord")));
      btn.addEventListener("click", function () {
        renderMatchCard(t.person, t.agreement);
        renderAlternates(top, t.person.id);
        lastSelectedId = t.person.id;
        $("g-name").focus();
      });
      li.appendChild(btn);
      alts.appendChild(li);
    });
  }

  function renderResult(st, selectedId) {
    show("result");
    var sel = st.top[0];
    for (var n = 0; n < st.top.length; n++) {
      if (st.top[n].person.id === selectedId) { sel = st.top[n]; break; }
    }
    lastSelectedId = selectedId || (sel && sel.person.id);
    renderMatchCard(sel.person, sel.agreement);
    renderAlternates(st.top, sel.person.id);
    $("btn-again").focus();
  }

  // ---- wiring --------------------------------------------------------------
  $("opt-0").addEventListener("click", function () { answer(0); });
  $("opt-1").addEventListener("click", function () { answer(1); });
  $("btn-back").addEventListener("click", takeBack);
  $("btn-restart").addEventListener("click", function () { show("quiz"); startGame(); });
  $("btn-again").addEventListener("click", startGame);

  $("lang-en").addEventListener("click", function () { setLang("en"); });
  $("lang-es").addEventListener("click", function () { setLang("es"); });
  $("lang-ca").addEventListener("click", function () { setLang("ca"); });

  // keyboard: 1/2 or A/B to answer
  document.addEventListener("keydown", function (ev) {
    if (screens.quiz.hidden || !currentQ) return;
    if (ev.key === "1" || ev.key === "a" || ev.key === "A") { ev.preventDefault(); answer(0); }
    else if (ev.key === "2" || ev.key === "b" || ev.key === "B") { ev.preventDefault(); answer(1); }
  });

  // guard against running without baked data
  if (typeof DP_DATA === "undefined" || !DP_DATA.people) {
    show("quiz");
    $("q-text").textContent = T("dataMissing");
    return;
  }

  // the landing page IS the first question
  LANG = pickInitialLang();
  document.documentElement.setAttribute("lang", LANG);
  renderStatic();
  updateLangButtons();
  startGame();
})();
