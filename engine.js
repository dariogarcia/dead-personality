/*
 * dead-personality engine — affinity matcher.
 * The visitor answers preference questions about themselves; the engine
 * scores every historical figure for shared preferences (idf-weighted)
 * and exposes the top matches with an agreement share.
 * UMD-lite: works as a classic <script> (window.DPEngine) and in Node (require).
 * Zero dependencies, zero network, zero DOM.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) { module.exports = factory(); }
  else { root.DPEngine = factory(); }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var DEFAULTS = {
    maxQuestions: 20,      // hard cap on questions asked (classic twenty)
    fameK: 0,              // fame prior weight; negative gently favors hidden gems
    missPenalty: 0.60,     // soft penalty for tags on the unchosen option
    dampenPenalty: 1.0,    // hard penalty for dampen tags on the chosen option
    tau: 3.0,              // softmax temperature for belief mass
    earlyStopShare: 0.95,  // stop early if top-1 mass share exceeds this...
    minBeforeStop: 8,      // ...but only after this many questions
    wildcardGate: 6,       // wildcards only eligible after this many questions
    wildcardNudgeAt: 9,    // if no wildcard used by now, boost them
    wildcardBonus: 0.6,    // the boost amount (entropy units)
    repeatPenalty: 0.15,    // per already-asked question of the same signal type
    openerQuestions: 3,    // the opening run: varied, preference-first questions
    openerSpread: 0.30,    // opening run: seeded pick among near-best openers
    placeDiscount: 0.45,    // multiplier on place/terrain question gain (climate)
    timeDiscount: 0.25,     // multiplier on time question gain (era)
    objectDiscount: 0.70    // multiplier on tool/equipment question gain (object):
                           // functional not preference-based, so it must be
                           // compelling indeed to earn a slot
  };

  // ---- deterministic RNG (mulberry32) -------------------------------------
  function makeRng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Deterministic tie-break jitter: pure function of (seed, qid, nAsked).
  // Same seed + same answers => same question sequence, so games replay
  // exactly and take-back is lossless.
  function jitter(seed, qid, nAsked) {
    var h = (seed >>> 0) ^ 0x9E3779B9;
    for (var i = 0; i < qid.length; i++) {
      h = (Math.imul(h ^ qid.charCodeAt(i), 0x01000193) >>> 0);
    }
    h = (Math.imul(h ^ (nAsked + 1), 0x85EBCA6B) >>> 0);
    h ^= h >>> 13; h = Math.imul(h, 0xC2B2AE35) >>> 0; h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  // ---- tag statistics ------------------------------------------------------
  function computeIdf(people) {
    var df = Object.create(null), N = people.length, i, j, t;
    for (i = 0; i < N; i++) {
      var tags = people[i].tags;
      for (j = 0; j < tags.length; j++) {
        t = tags[j];
        df[t] = (df[t] || 0) + 1;
      }
    }
    var idf = Object.create(null);
    for (t in df) { idf[t] = Math.log(1 + N / df[t]); }
    return idf;
  }

  function tagSet(person) {
    if (!person._tagSet) {
      var s = Object.create(null);
      for (var i = 0; i < person.tags.length; i++) s[person.tags[i]] = true;
      person._tagSet = s;
    }
    return person._tagSet;
  }

  // Score deltas for this person picking each option of a question: boost
  // tags minus miss/dampen exposure, in idf units. Pure function of
  // (person, question, penalties); shared by the vote oracle and the
  // agreement metric so both stay self-consistent with the scoring rule.
  function voteDelta(person, question, idf, cfg) {
    var missP = (cfg && cfg.missPenalty !== undefined) ? cfg.missPenalty : 0.30;
    var dampP = (cfg && cfg.dampenPenalty !== undefined) ? cfg.dampenPenalty : 1.0;
    var ts = tagSet(person), delta = [0, 0];
    for (var o = 0; o < 2; o++) {
      var boost = question.options[o].tags || [];
      var miss = question.options[1 - o].tags || [];
      var dampen = question.options[o].dampen || [];
      var d = 0, i;
      for (i = 0; i < boost.length; i++) if (ts[boost[i]]) d += idf[boost[i]] || 0;
      for (i = 0; i < miss.length; i++) if (ts[miss[i]]) d -= missP * (idf[miss[i]] || 0);
      for (i = 0; i < dampen.length; i++) if (ts[dampen[i]]) d -= dampP * (idf[dampen[i]] || 0);
      delta[o] = d;
    }
    return delta;
  }

  // Which option would this person pick? (oracle used by simulations)
  // Self-consistent with the scoring rule: the person backs the option that
  // improves their own score the most (boosts, minus miss/dampen exposure).
  // Returns 0, 1, or null (no stake in the question at all).
  function personVote(person, question, idf, cfg) {
    var delta = voteDelta(person, question, idf, cfg);
    if (delta[0] === 0 && delta[1] === 0) return null;
    if (delta[0] === delta[1]) return null;
    return delta[0] > delta[1] ? 0 : 1;
  }

  // Vote memo: personVote is pure in (person, question, penalties) and the
  // same roster is reused across a whole session (and thousands of simulated
  // sessions at build time), so cache one votes-array per question object.
  var voteMemo = new WeakMap(); // people array -> { missP, dampP, byQ: Map }
  function cachedVotes(people, q, idf, cfg) {
    var missP = (cfg && cfg.missPenalty !== undefined) ? cfg.missPenalty : 0.30;
    var dampP = (cfg && cfg.dampenPenalty !== undefined) ? cfg.dampenPenalty : 1.0;
    var rec = voteMemo.get(people);
    if (!rec || rec.missP !== missP || rec.dampP !== dampP) {
      rec = { missP: missP, dampP: dampP, byQ: new Map() };
      voteMemo.set(people, rec);
    }
    var v = rec.byQ.get(q);
    if (!v) {
      v = new Array(people.length);
      for (var n = 0; n < people.length; n++) v[n] = personVote(people[n], q, idf, cfg);
      rec.byQ.set(q, v);
    }
    return v;
  }

  // ---- game ----------------------------------------------------------------
  function createGame(opts) {
    opts = opts || {};
    var people = opts.people, questions = opts.questions;
    if (!Array.isArray(people) || !people.length) throw new Error("people required");
    if (!Array.isArray(questions) || !questions.length) throw new Error("questions required");

    var cfg = {};
    for (var k in DEFAULTS) cfg[k] = (opts.config && opts.config[k] !== undefined) ? opts.config[k] : DEFAULTS[k];
    var gameSeed = (opts.seed === undefined ? 42 : opts.seed) >>> 0;

    var idf = computeIdf(people);
    var byId = Object.create(null);
    var i, j;
    for (i = 0; i < people.length; i++) byId[people[i].id] = people[i];

    // state
    var scores = new Array(people.length);     // additive, order-independent
    var answers = [];                           // [{qid, option}]
    var asked = Object.create(null);            // qid -> true
    for (i = 0; i < people.length; i++) {
      scores[i] = cfg.fameK * (people[i].fame - 5);
    }

    // ---- belief mass (softmax over scores / tau) ----
    function masses() {
      var max = -Infinity;
      for (i = 0; i < people.length; i++) if (scores[i] > max) max = scores[i];
      var exps = new Array(people.length), sum = 0;
      for (i = 0; i < people.length; i++) {
        exps[i] = Math.exp((scores[i] - max) / cfg.tau);
        sum += exps[i];
      }
      for (i = 0; i < people.length; i++) exps[i] /= sum;
      return exps;
    }

    function ranked() {
      var idx = [];
      for (i = 0; i < people.length; i++) idx.push(i);
      idx.sort(function (a, b) {
        if (scores[b] !== scores[a]) return scores[b] - scores[a];
        return people[a].id < people[b].id ? -1 : 1; // stable tie-break by id
      });
      return idx;
    }

    // ---- expected information gain of a question ----
    // Stake-weighted entropy: only mass with a real stake in the question
    // carries information. A question everyone abstains from has zero gain,
    // not maximum gain (the naive 50/50 split would otherwise dominate).
    function questionGain(q, mass) {
      var pA = 0, pB = 0, pAbstain = 0;
      var votes = cachedVotes(people, q, idf, cfg);
      for (i = 0; i < people.length; i++) {
        var v = votes[i];
        if (v === 0) pA += mass[i];
        else if (v === 1) pB += mass[i];
        else pAbstain += mass[i];
      }
      var stake = pA + pB;
      if (stake < 1e-12) return { entropy: 0, pA: 0.5, pB: 0.5, stake: 0 };
      var fA = pA / stake, fB = pB / stake;
      var H = -(fA * Math.log2(fA || 1e-12) + fB * Math.log2(fB || 1e-12));
      // balance bonus: reward near-even splits of the stake itself
      var entropy = stake * H;
      return { entropy: entropy, pA: pA, pB: pB, stake: stake };
    }

    function signalCounts() {
      var c = Object.create(null);
      for (var qid in asked) {
        var q = findQ(qid);
        if (q) c[q.signal] = (c[q.signal] || 0) + 1;
      }
      return c;
    }

    function findQ(qid) {
      for (var n = 0; n < questions.length; n++) if (questions[n].id === qid) return questions[n];
      return null;
    }

    function usedWildcard() {
      for (var n = 0; n < questions.length; n++) {
        if (asked[questions[n].id] && questions[n].wildcard) return true;
      }
      return false;
    }

    // ---- pick next question ----
    function nextQuestion() {
      if (isDone()) return null;
      var mass = masses();
      var sigCount = signalCounts();
      var nAsked = answers.length;
      var hasOpeners = false;
      for (var h = 0; h < questions.length; h++) { if (questions[h].opener) { hasOpeners = true; break; } }
      // Opening run: preference-first (opener-flagged) questions, no signal
      // repeated, picked among the near-best so every game starts differently.
      var opening = nAsked < cfg.openerQuestions && hasOpeners;
      var all = [], n, q;
      for (n = 0; n < questions.length; n++) {
        q = questions[n];
        if (asked[q.id]) continue;
        if (q.wildcard && nAsked < cfg.wildcardGate) continue;
        var gain = questionGain(q, mass);
        // personality/taste questions lead; time, place, and mere tools are
        // discounted so they only surface when their stake is compelling
        var weight = q.signal === "climate" ? cfg.placeDiscount
          : q.signal === "era" ? cfg.timeDiscount
          : q.signal === "object" ? cfg.objectDiscount : 1.0;
        var score = gain.entropy * weight;
        score -= (sigCount[q.signal] || 0) * cfg.repeatPenalty;
        if (q.wildcard && nAsked >= cfg.wildcardNudgeAt && !usedWildcard()) score += cfg.wildcardBonus;
        all.push({ q: q, score: score, gain: gain });
      }
      if (!all.length) return null;
      var candidates = all;
      if (opening) {
        // distinct signals across the opening run; relax only if impossible
        var strict = all.filter(function (c) { return c.q.opener && !sigCount[c.q.signal]; });
        if (strict.length) candidates = strict;
        else {
          var openers = all.filter(function (c) { return c.q.opener; });
          if (openers.length) candidates = openers;
        }
      }
      candidates.sort(function (a, b) {
        if (b.score !== a.score) return b.score - a.score;
        return a.q.id < b.q.id ? -1 : 1; // deterministic; rng shuffles below
      });
      // deterministic tie-break among near-equal candidates: same seed +
      // same answer history always yields the same question sequence.
      // During the opening run, spread the seeded pick across near-best
      // candidates so repeat games do not start identically.
      var margin = opening ? cfg.openerSpread : 1e-9;
      var top = candidates.filter(function (c) { return candidates[0].score - c.score <= margin; });
      var pick = top[Math.floor(jitter(gameSeed, "pick:" + answers.length, nAsked) * top.length) % top.length];
      return pick ? pick.q : null;
    }

    function isDone() {
      if (answers.length >= cfg.maxQuestions) return true;
      if (answers.length >= cfg.minBeforeStop) {
        var mass = masses();
        var r = ranked();
        if (mass[r[0]] > cfg.earlyStopShare) return true;
      }
      if (allAnswered()) return true;
      return false;
    }

    function allAnswered() {
      for (var n = 0; n < questions.length; n++) if (!asked[questions[n].id]) return false;
      return true;
    }

    // ---- answer a question ----
    function answer(qid, optionIndex) {
      var q = findQ(qid);
      if (!q) throw new Error("unknown question: " + qid);
      if (asked[qid]) throw new Error("question already asked: " + qid);
      if (optionIndex !== 0 && optionIndex !== 1) throw new Error("option must be 0 or 1");
      var chosen = q.options[optionIndex];
      var other = q.options[1 - optionIndex];
      var boost = chosen.tags || [], miss = other.tags || [], dampen = chosen.dampen || [];
      for (i = 0; i < people.length; i++) {
        var ts = tagSet(people[i]), s = scores[i], j2;
        for (j2 = 0; j2 < boost.length; j2++) if (ts[boost[j2]]) s += idf[boost[j2]] || 0;
        for (j2 = 0; j2 < miss.length; j2++) if (ts[miss[j2]]) s -= cfg.missPenalty * (idf[miss[j2]] || 0);
        for (j2 = 0; j2 < dampen.length; j2++) if (ts[dampen[j2]]) s -= cfg.dampenPenalty * (idf[dampen[j2]] || 0);
        scores[i] = s;
      }
      asked[qid] = true;
      answers.push({ qid: qid, option: optionIndex });
      return publicState();
    }

    // ---- receipts: why does person `id` rank where it does? ----
    function receiptsFor(person) {
      var ts = tagSet(person), out = [];
      for (var a = 0; a < answers.length; a++) {
        var q = findQ(answers[a].qid);
        var chosen = q.options[answers[a].option];
        var other = q.options[1 - answers[a].option];
        var matched = [], missed = [], dampened = [];
        var list = chosen.tags || [];
        for (var n = 0; n < list.length; n++) if (ts[list[n]]) matched.push(list[n]);
        list = other.tags || [];
        for (n = 0; n < list.length; n++) if (ts[list[n]]) missed.push(list[n]);
        list = chosen.dampen || [];
        for (n = 0; n < list.length; n++) if (ts[list[n]]) dampened.push(list[n]);
        var d = voteDelta(person, q, idf, cfg);
        var vote = (d && (d[0] !== 0 || d[1] !== 0) && d[0] !== d[1]) ? (d[0] > d[1] ? 0 : 1) : null;
        out.push({
          qid: q.id, question: q.text, chosen: chosen.label,
          matched: matched, missed: missed, dampened: dampened,
          vote: vote, option: answers[a].option
        });
      }
      return out;
    }

    // ---- agreement share ----
    // Vote-based: of the questions where this person would pick a side,
    // weighted by how strongly they'd pick it (stake = score delta between
    // the options), what share of that stake did the visitor's answers back?
    // Early on, if every answered question went the person's way, this is
    // exactly 100% — it can only drop once answers genuinely diverge.
    function agreementFor(person) {
      var pos = 0, total = 0;
      for (var a = 0; a < answers.length; a++) {
        var q = findQ(answers[a].qid);
        var d = voteDelta(person, q, idf, cfg);
        if (!d || (d[0] === 0 && d[1] === 0) || d[0] === d[1]) continue;
        var stake = Math.abs(d[0] - d[1]);
        total += stake;
        if ((d[0] > d[1] ? 0 : 1) === answers[a].option) pos += stake;
      }
      return total > 0 ? pos / total : null;
    }

    function publicState() {
      var r = ranked(), mass = masses();
      // Featured match: early in the game many people are statistically
      // indistinguishable (scores within AG_EPS). Among those, feature the
      // one whose own votes line up best with the visitor's answers — so
      // the proposed soulmate agrees with everything answered so far — and,
      // among equally-agreeing near-ties, the less famous one (hidden gems
      // first; the famous are easy to find without us).
      var AG_EPS = 1.25;
      var topScore = scores[r[0]];
      var feat = 0, featAg = agreementFor(people[r[0]]);
      featAg = featAg === null ? -1 : featAg;
      var featFame = people[r[0]].fame;
      for (var f = 1; f < r.length; f++) {
        if (topScore - scores[r[f]] > AG_EPS) break;
        var agF = agreementFor(people[r[f]]);
        var famF = people[r[f]].fame;
        if (agF === null) continue;
        var better = agF > featAg || (agF === featAg && famF < featFame);
        if (featAg === -1 ? true : better) { feat = f; featAg = agF; featFame = famF; }
      }
      if (feat > 0) r.unshift(r.splice(feat, 1)[0]);
      var top = [];
      for (var n = 0; n < Math.min(8, r.length); n++) {
        var ag = agreementFor(people[r[n]]);
        top.push({
          person: people[r[n]],
          score: Math.round(scores[r[n]] * 1000) / 1000,
          mass: Math.round(mass[r[n]] * 10000) / 10000,
          agreement: ag === null ? null : Math.round(ag * 10000) / 10000
        });
      }
      return {
        asked: answers.length,
        maxQuestions: cfg.maxQuestions,
        done: isDone(),
        next: isDone() ? null : nextQuestion(),
        top: top
      };
    }

    return {
      answer: answer,
      state: publicState,
      nextQuestion: nextQuestion,
      isDone: isDone,
      receiptsFor: receiptsFor,
      agreementFor: agreementFor,
      config: cfg,
      // exposed for tooling/tests
      _scores: function () { return scores.slice(); },
      _masses: masses,
      _ranked: ranked,
      _idf: idf,
      _answers: function () { return answers.slice(); }
    };
  }

  return {
    createGame: createGame,
    computeIdf: computeIdf,
    personVote: personVote,
    voteDelta: voteDelta,
    makeRng: makeRng,
    DEFAULTS: DEFAULTS
  };
});
