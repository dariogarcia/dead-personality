# dead-personality — Find your dead soulmate

An offline-first, zero-network affinity service: you answer questions
about your own tastes and temperament, and it maps your answers onto a
curated pool of **741 historical figures** — surfacing the dead who
shared your preferences, with a receipt of exactly what you have in
common.

**Play it here: <https://dariogarcia.github.io/dead-personality/>**

The **landing page is the first question**: no start screen, no
interstitial. A mystery panel with a question mark sits beside the quiz
from the first moment; from your **third answer** it becomes a
**continuous side panel** — the current top match in large detail
(portrait, agreement share, what you share, a plain-language
explanation), with the next names underneath, all clickable.
Personality, temperament and preference questions come first;
when-and-where questions (era, climate) are deliberately discounted so
they only appear late, if at all.

**Languages**: English, Español, Català. Detected from the browser,
switchable any time from the header; the choice is remembered.

## How it works

The pool is **741 hand-curated people** across sixteen domain files
(our own words — no Wikidata dumps, no scraped bios), each described
by a fame score, a blurb, and 10–25 kebab-case tags. The **93 binary
questions** are phrased in the second person — the visitor answers for
themselves, and each option carries tag sets: choosing it boosts
figures carrying those tags by `idf(t) = ln(1 + N/df(t))`, softly
penalizes tags on the unchosen side, and hard-penalizes `dampen` tags
(word-sense exclusion). Scores are additive and order-independent;
ties break by stable id.

**Matching is biased toward hidden gems** (`fameK = -1.5`): featured
matches skew measurably less famous than the pool while self-match
accuracy holds. The first three questions are a dedicated **opener
phase** with distinct signals, so each visit starts with a different
trio. Everything is deterministic given the game seed, so the take-back
button replays the exact same question sequence.

Agreement is **vote-based**: for each question, a person's *vote* is
the option their tags would push them toward, weighted by how strongly
(the stake). The agreement share is the fraction of staked weight the
visitor's answers backed — while all your answers go the person's way,
agreement reads exactly **100%**; it only drops once you genuinely
diverge. The result screen shows the top eight **kindred spirits**,
each with per-question receipts of what you share; alternates are
clickable to inspect their own receipts. Most figures also carry an
**attested quote** — a documented saying by or about the person — and
**question-matched quotes** pin a documented line to the exact question
it speaks to (Bach on coffee under the tea-or-coffee receipt). Nothing
is fabricated; people without quotable material fall back to
receipts-only.

Quality headlines from the build's simulation battery (self-match:
feed a figure's own preference votes back as answers):

- **~25% top-1, ~35% top-3** self-match over a 741-person pool —
  roughly 185× over random for top-1, and the honest cost of
  prioritizing personality questions over time-and-place questions.
- **~340 distinct people** top the affinity list in some session; no
  session ever concentrates on one figure.
- Adversarial sessions (always option A / always option B) terminate
  cleanly in ≤ 20 questions.
- Replay stability: same answers, same matches, every time.

## Portraits and image licensing

All images are fetched **once, at build time** from
Wikipedia/Wikimedia Commons and shipped locally under `img/` — the
page itself loads nothing from the network. Only images whose license
verifies as **public domain, CC0, CC-BY or CC-BY-SA** (or "no
restrictions") are accepted; fair-use and ND images are rejected. Each
portrait is cross-checked against the person's Wikipedia extract
(born/died years) to avoid wrong-person matches. The result screen
shows the artist and license under the photo; people without a usable
portrait get a deterministic monogram fallback. **Book covers are
deliberately not shipped**: the rights to a book's cover art usually
stay with the publisher, so the "Read about them" section lists books
as outbound Open Library search links instead.

## Privacy and constraints

1. **No network requests.** The page makes **zero** requests on load
   and while playing — portraits are local files, there is no tracking,
   no analytics, no cookies. Answers never leave the browser. The only
   outbound anything is `<a href>` links to Open Library search pages
   for the matched person's books — opened only if clicked
   (`rel="noopener noreferrer"`).
2. **No bulk downloads.** The dataset is hand-written JSON. The only
   build-time network use is a polite, rate-limited, resumable portrait
   fetcher; the roster and questions are never scraped.
3. **Small payload.** The whole site is ~23 MB (build fails above a
   24 MB cap), almost all of it locally shipped portraits.

## Accessibility

- `prefers-reduced-motion` disables transitions and glow animations.
- All controls are real buttons; the question text is an
  `aria-live="polite"` region; keyboard: `1`/`2` or `A`/`B` to answer.
- Portrait images are decorative (`alt=""`); every person renders a
  text monogram when no licensed photo exists.
- The layout collapses to a single column below 800 px.

## Run it locally

This repository ships the fully built, static site. Clone it and open
`index.html` in any browser — it works over `file://` with no server,
no dependencies, and no build step. To serve it instead:

```sh
python3 -m http.server 8420
```

## About this service — please read

This website is a free, non-commercial service provided as a research
experiment. It was designed, coded, and is largely maintained with the
help of **open-source AI models**, as part of an ongoing experiment to
assess the quality and limits of open models for complex software
development. The models run on public research infrastructure hosted
at the [Barcelona Supercomputing Center (BSC)](https://www.bsc.es); the
site itself is deployed on public hosting. This is an internal research
project: it is **not an official BSC product or publication**, it does
not represent the positions of BSC, and BSC does not endorse and is not
responsible for its content.

The service is provided **free of charge, "as is" and "as available"**,
without warranties of any kind, express or implied. Because much of its
content and code is machine-generated, it **may contain errors, bugs,
inaccuracies, or outdated information**. Do not rely on it as a sole or
authoritative source; always verify critical information independently.

There is no guarantee of availability, continuity, or support: the
service may be modified, suspended, or discontinued at any time. The
author accepts no liability for any loss or damage arising from the use
of, or inability to use, this service.

Feedback, bug reports, and suggestions are welcome and help improve
both this service and the underlying research — please
[open an issue](https://github.com/dariogarcia/dead-personality/issues).

---

### Sobre este servicio — por favor, lee esto

Este sitio web es un servicio gratuito y no comercial ofrecido como
experimento de investigación. Ha sido diseñado, programado y se mantiene
en gran parte con ayuda de **modelos de IA de código abierto**, dentro
de un experimento en curso para evaluar la calidad y los límites de los
modelos abiertos en el desarrollo de software complejo. Los modelos se
ejecutan en la infraestructura de investigación pública del
[Barcelona Supercomputing Center (BSC)](https://www.bsc.es); el sitio se
publica en un alojamiento público. Se trata de un proyecto de
investigación interno: **no es un producto ni una publicación oficial
del BSC**, no representa las posiciones del BSC, y el BSC no respalda
ni es responsable de su contenido.

El servicio se ofrece **gratis, "tal cual" y "según disponibilidad"**,
sin garantías de ningún tipo, expresas o implícitas. Dado que gran parte
de su contenido y código está generada por máquinas, **puede contener
errores, fallos, inexactitudes o información desactualizada**. No lo
uses como fuente única o autoritativa: verifica siempre la información
crítica por tu cuenta.

No se garantiza la disponibilidad, la continuidad ni el soporte: el
servicio puede modificarse, suspenderse o interrumpirse en cualquier
momento. El autor no asume responsabilidad alguna por daños o
perjuicios derivados del uso, o de la imposibilidad de uso, de este
servicio.

Los comentarios, informes de errores y sugerencias son bienvenidos y
ayudan a mejorar tanto este servicio como la investigación subyacente —
[abre un issue](https://github.com/dariogarcia/dead-personality/issues).

---

### Sobre aquest servei — si us plau, llegeix això

Aquest lloc web és un servei gratuït i no comercial ofert com a
experiment de recerca. Ha estat dissenyat, programat i es manté en
gran part amb ajuda de **models d'IA de codi obert**, dins d'un
experiment en curs per avaluar la qualitat i els límits dels models
oberts en el desenvolupament de programari complex. Els models
s'executen a la infraestructura de recerca pública del
[Barcelona Supercomputing Center (BSC)](https://www.bsc.es); el lloc es
publica en un allotjament públic. Es tracta d'un projecte de recerca
intern: **no és un producte ni una publicació oficial del BSC**, no
representa les posicions del BSC, i el BSC no recolza ni és responsable
del seu contingut.

El servei s'ofereix **gratis, "tal qual" i "segons disponibilitat"**,
sense garanties de cap mena, expressades o implícides. Atès que gran
part del seu contingut i codi està generat per màquines, **pot
contenir errors, fallades, inexactituts o informació desactualitzada**.
No l'utilitzis com a font única o autoritzativa: verifica sempre la
informació crítica pel teu compte.

No es garanteix la disponibilitat, la continuïtat ni el suport: el
servei es pot modificar, suspendre o interrompre en qualsevol moment.
L'autor no assumeix cap responsabilitat per danys o perjudicis
derivats de l'ús, o de la impossibilitat d'ús, d'aquest servei.

Els comentaris, informes d'errors i suggeriments són benvinguts i
ajuden a millorar tant aquest servei com la recerca subjacent —
[obre un issue](https://github.com/dariogarcia/dead-personality/issues).
