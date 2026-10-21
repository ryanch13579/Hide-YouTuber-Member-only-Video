// Finds video cards on YouTube, checks whether each video is paid, and hides
// the paid ones (or skips them in the Shorts player).
(() => {
  "use strict";
  if (window.top !== window) return;

  const detect = globalThis.HPW_DETECT;
  const DAY = 864e5;

  // Everything YouTube-specific that may need updating lives here.
  const CFG = {
    links: 'a[href*="/watch?v="], a[href*="/shorts/"]',
    outerCards: [
      "ytd-rich-item-renderer",
      "ytd-video-renderer",
      "ytd-compact-video-renderer",
      "ytd-grid-video-renderer",
      "ytd-reel-item-renderer",
      "ytd-movie-renderer",
      "ytd-grid-movie-renderer",
      "ytd-compact-movie-renderer",
    ].join(","),
    innerCards: [
      "yt-lockup-view-model",
      "ytm-shorts-lockup-view-model-v2",
      "ytm-shorts-lockup-view-model",
    ].join(","),
    shortsNext:
      '#navigation-button-down button, button[aria-label="Next video"]',
    maxConcurrent: 6,
    lookAhead: "800px 0px",
    scanDelay: 200,
    recheckDays: 7,
    maxCached: 10000,
    maxAttempts: 3,
    skipDelay: 1200,
    maxSkipTries: 3,
  };

  const KINDS = ["members", "paid"];
  const DEFAULTS = { enabled: true, members: true, paid: true };
  const ID_RE = /^[\w-]{11}$/;
  const html = document.documentElement;
  // Bump whenever detect.js changes; answers saved under older rules are discarded.
  const RULES = 3;

  let settings = { ...DEFAULTS };
  let alive = true;

  const verdicts = new Map();
  const paths = new Map();
  const attempts = new Map();
  const visible = new WeakSet();
  let scannedHref = new WeakMap();
  const queue = [];
  const backlog = [];
  const queued = new Set();
  const wanted = new Set();
  const stats = {
    answered: 0,
    failed: 0,
    lastError: "",
    skipClicks: 0,
    skipKeys: 0,
    skipStuck: 0,
  };

  let active = 0;
  let pausedUntil = 0;
  let failures = 0;
  let scanTimer = 0;
  let saveTimer = 0;
  let skipping = { id: "", tries: 0, at: 0, stuck: false };
  let bannerEl = null;

  const withDefaults = (stored) => ({ ...DEFAULTS, ...stored });

  const hiding = (kind) => settings.enabled && settings[kind];

  function applyMode() {
    html.classList.toggle("hpw-hide", settings.enabled);
    for (const kind of KINDS) html.classList.toggle("hpw-" + kind, hiding(kind));
  }
  applyMode();

  function safeChrome(fn) {
    if (!alive) return Promise.resolve();
    try {
      return Promise.resolve(fn()).catch(() => {});
    } catch {
      alive = false;
      return Promise.resolve();
    }
  }

  // Cache: a paid video maps to its kind and is kept for good; a free one maps to
  // the day it was checked and is re-checked after CFG.recheckDays. Stored as
  // back-to-back 11-character ids: { members: "…", paid: "…", ok: { "<day>": "…" } }
  const today = () => Math.floor(Date.now() / DAY);
  const isPaid = (v) => typeof v === "string";
  const isFresh = (v) => isPaid(v) || today() - v < CFG.recheckDays;
  const stateOf = (kind) => kind || "ok";

    function known(id) {
    const v = verdicts.get(id);
    return v !== undefined && isFresh(v) ? isPaid(v) && v : undefined;
  }

  function* idsIn(ids) {
    for (let i = 0; i + 11 <= ids.length; i += 11) yield ids.slice(i, i + 11);
  }

    function decode(stored) {
    if (!stored) return [];
    const out = [];
    if (stored.ok && typeof stored.ok === "object")
      for (const [day, ids] of Object.entries(stored.ok))
        for (const id of idsIn(ids)) out.push([id, +day]);
    for (const kind of KINDS)
      if (typeof stored[kind] === "string")
        for (const id of idsIn(stored[kind])) out.push([id, kind]);
    return out;
  }

  const isNewer = (a, b) =>
    b === undefined || (a !== b && (isPaid(a) || (!isPaid(b) && a > b)));

  function remember(id, v) {
    verdicts.delete(id);
    verdicts.set(id, v);
  }

    function merge(stored) {
    let changed = 0;
    for (const [id, v] of decode(stored)) {
      if (!isNewer(v, verdicts.get(id))) continue;
      remember(id, v);
      changed++;
    }
    return changed;
  }

  function scheduleSave() {
    if (!saveTimer) saveTimer = setTimeout(saveNow, 1500);
  }

  function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    for (const [id, v] of verdicts) if (!isFresh(v)) verdicts.delete(id);
    let excess = verdicts.size - CFG.maxCached;
    for (const restricted of [false, true]) {
      for (const [id, v] of verdicts) {
        if (excess <= 0) break;
        if (isPaid(v) !== restricted) continue;
        verdicts.delete(id);
        excess--;
      }
    }
    const out = { members: "", paid: "", ok: {} };
    for (const [id, v] of verdicts) {
      if (isPaid(v)) out[v] += id;
      else out.ok[v] = (out.ok[v] || "") + id;
    }
    safeChrome(() => chrome.storage.local.set({ verdicts: out }));
  }

  function videoRef(url) {
    if (url.pathname === "/watch") {
      const id = url.searchParams.get("v");
      return id && ID_RE.test(id)
        ? { id, kind: "watch", path: "/watch?v=" + id }
        : null;
    }
    const m = /^\/shorts\/([\w-]{11})(?:\/|$)/.exec(url.pathname);
    return m ? { id: m[1], kind: "shorts", path: "/shorts/" + m[1] } : null;
  }

  function parseVideoLink(href) {
    if (!href) return null;
    let url;
    try {
      url = new URL(href, location.origin);
    } catch {
      return null;
    }
    if (url.hostname !== location.hostname) return null;
    if (url.pathname === "/watch" && url.searchParams.has("list")) return null;
    return videoRef(url);
  }

  const openVideo = () => videoRef(new URL(location.href));

  function rememberPath(ref) {
    if (!paths.has(ref.id)) paths.set(ref.id, ref.path);
  }

  const cardFor = (link) =>
    link.closest(CFG.outerCards) || link.closest(CFG.innerCards);
  const pendingCards = () => document.querySelectorAll('[data-hpw="pending"]');

  const viewport = new IntersectionObserver(
    (entries) => {
      for (const { target: card, isIntersecting } of entries) {
        if (!isIntersecting) {
          visible.delete(card);
          continue;
        }
        visible.add(card);
        if (card.dataset.hpw === "pending") enqueue(card.dataset.hpwId, true);
      }
    },
    { rootMargin: CFG.lookAhead },
  );

  function scheduleScan() {
    if (!scanTimer) scanTimer = setTimeout(scan, CFG.scanDelay);
  }

  function scan() {
    scanTimer = 0;
    if (!settings.enabled || !alive) return;
    const seen = new Set();
    for (const link of document.querySelectorAll(CFG.links)) {
      const href = link.getAttribute("href");
      if (scannedHref.get(link) === href) continue;
      const card = cardFor(link);
      if (!card) continue;
      scannedHref.set(link, href);
      if (seen.has(card)) continue;
      const ref = parseVideoLink(href);
      if (!ref) continue;
      seen.add(card);
      // YouTube reuses card elements for different videos, so re-read the id each scan.
      if (card.dataset.hpwId === ref.id) continue;
      card.dataset.hpwId = ref.id;
      rememberPath(ref);
      viewport.observe(card);
      resolve(card, ref.id);
    }
    checkOpenVideo();
  }

  function resolve(card, id) {
    const v = known(id);
    card.dataset.hpw = v === undefined ? "pending" : stateOf(v);
    if (v === undefined) enqueue(id, visible.has(card));
  }

  function paint(id) {
    const v = known(id);
    if (v === undefined) return;
    for (const card of document.querySelectorAll(`[data-hpw-id="${id}"]`))
      card.dataset.hpw = stateOf(v);
  }

  function resetCards() {
    scannedHref = new WeakMap();
    for (const card of document.querySelectorAll("[data-hpw-id]")) {
      delete card.dataset.hpwId;
      delete card.dataset.hpw;
    }
  }

  function checkOpenVideo() {
    const cur = openVideo();
    if (!cur || !settings.enabled) return banner(null);
    const v = known(cur.id);
    if (v === undefined) {
      banner(null);
      rememberPath(cur);
      wanted.add(cur.id);
      enqueue(cur.id, true);
      return;
    }
    if (cur.kind !== "shorts" || !v || !hiding(v)) return banner(null);
    skipShort(cur.id);
  }

  function skipShort(id) {
    const now = Date.now();
    if (skipping.id !== id) skipping = { id, tries: 0, at: 0, stuck: false };
    if (skipping.stuck || now - skipping.at < CFG.skipDelay) return;
    if (skipping.tries >= CFG.maxSkipTries) {
      skipping.stuck = true;
      stats.skipStuck++;
      banner("Paid Short – could not skip automatically");
      return;
    }
    skipping.at = now;
    skipping.tries++;

    const next = document.querySelector(CFG.shortsNext);
    if (next) {
      stats.skipClicks++;
      next.click();
    } else {
      stats.skipKeys++;
      const init = {
        key: "ArrowDown",
        code: "ArrowDown",
        keyCode: 40,
        which: 40,
        bubbles: true,
        cancelable: true,
      };
      (document.activeElement || document.body).dispatchEvent(
        new KeyboardEvent("keydown", init),
      );
    }
    setTimeout(checkOpenVideo, CFG.skipDelay + 100);
  }

  function banner(text) {
    if (!text) {
      bannerEl?.remove();
      bannerEl = null;
      return;
    }
    bannerEl ??= Object.assign(document.createElement("div"), {
      id: "hpw-banner",
    });
    if (bannerEl.textContent !== text) bannerEl.textContent = text;
    if (!bannerEl.isConnected && document.body) document.body.append(bannerEl);
  }

  function enqueue(id, soon) {
    if (!id) return;
    if (queued.has(id)) {
      if (!soon) return;
      const b = backlog.indexOf(id);
      if (b !== -1) {
        backlog.splice(b, 1);
        queue.push(id);
        return;
      }
      const at = wanted.has(id) ? queue.indexOf(id) : -1;
      if (at !== -1) queue.push(queue.splice(at, 1)[0]);
      return;
    }
    if ((attempts.get(id) || 0) >= CFG.maxAttempts) return;
    queued.add(id);
    (soon ? queue : backlog).push(id);
    pump();
  }

  function pump() {
    if (!settings.enabled || !alive || Date.now() < pausedUntil) return;
    while (active < CFG.maxConcurrent && (queue.length || backlog.length)) {
      const id = queue.length ? queue.pop() : backlog.shift();
      const stillNeeded =
        wanted.has(id) ||
        document.querySelector(`[data-hpw-id="${id}"][data-hpw="pending"]`);
      if (!stillNeeded) {
        queued.delete(id);
        continue;
      }
      active++;
      check(id).finally(() => {
        active--;
        queued.delete(id);
        pump();
      });
    }
  }

  async function lookup(id) {
    try {
      const res = await fetch(paths.get(id) || "/watch?v=" + id, {
        credentials: "same-origin",
      });
      if (!res.ok) {
        return {
          problem: "HTTP " + res.status,
          backOff: res.status === 429 || res.status >= 500,
        };
      }
      const verdict = await detect.readResponse(res);
      return verdict === undefined
        ? { problem: "response was not a video page" }
        : { verdict };
    } catch (e) {
      return { problem: "request failed: " + (e?.message || e), backOff: true };
    }
  }

  async function check(id) {
    const { verdict, problem, backOff } = await lookup(id);
    wanted.delete(id);

    if (verdict !== undefined) {
      failures = 0;
      stats.answered++;
      attempts.delete(id);
      paths.delete(id);
      remember(id, verdict || today());
      paint(id);
      scheduleSave();
      checkOpenVideo();
      return;
    }

    // No answer: leave the card visible and never cache a guess.
    stats.failed++;
    stats.lastError = problem;
    attempts.set(id, (attempts.get(id) || 0) + 1);
    let wait = 60e3;
    if (backOff) {
      failures++;
      wait = Math.min(30e3 * 2 ** (failures - 1), 10 * 60e3);
      pausedUntil = Date.now() + wait;
    }
    setTimeout(retryPending, wait + 100);
  }

  function retryPending() {
    for (const card of pendingCards()) {
      enqueue(card.dataset.hpwId, visible.has(card));
    }
    checkOpenVideo();
    pump();
  }

  function ancestry(el) {
    const chain = [];
    for (
      ;
      el && el !== document.body && chain.length < 9;
      el = el.parentElement
    ) {
      chain.push(el.localName + (el.id ? "#" + el.id : ""));
    }
    return chain.join(" < ");
  }

  function openVideoStatus() {
    const cur = openVideo();
    if (!cur) return null;
    const v = known(cur.id);
    const label =
      v === undefined
        ? queued.has(cur.id)
          ? "checking"
          : "unknown"
        : v || "free";
    return { kind: cur.kind, id: cur.id, label };
  }

  function report() {
    const cards = new Set();
    const states = { members: 0, paid: 0, ok: 0, pending: 0 };
    const cardTags = {};
    const strayExamples = [];
    let strayLinks = 0;

    for (const link of document.querySelectorAll(CFG.links)) {
      if (!parseVideoLink(link.getAttribute("href"))) continue;
      const card = cardFor(link);
      if (!card) {
        strayLinks++;
        if (strayExamples.length < 4) {
          const chain = ancestry(link);
          if (!strayExamples.includes(chain)) strayExamples.push(chain);
        }
        continue;
      }
      if (cards.has(card)) continue;
      cards.add(card);
      cardTags[card.localName] = (cardTags[card.localName] || 0) + 1;
      if (card.dataset.hpw in states) states[card.dataset.hpw]++;
    }

    let version = "";
    try {
      version = chrome.runtime.getManifest().version;
    } catch {}

    return {
      version,
      page: location.pathname,
      enabled: settings.enabled,
      hiding: { members: hiding("members"), paid: hiding("paid") },
      cards: cards.size,
      states,
      cardTags,
      strayLinks,
      strayExamples,
      openVideo: openVideoStatus(),
      lookups: {
        answered: stats.answered,
        failed: stats.failed,
        lastError: stats.lastError,
        running: active,
        waiting: queue.length + backlog.length,
        pausedSeconds: Math.max(
          0,
          Math.round((pausedUntil - Date.now()) / 1000),
        ),
      },
      shorts: {
        nextButtonFound: !!document.querySelector(CFG.shortsNext),
        skipClicks: stats.skipClicks,
        skipKeys: stats.skipKeys,
        skipStuck: stats.skipStuck,
      },
      saved: verdicts.size,
    };
  }

  function onStorageChanged(changes, area) {
    if (area !== "local") return;
    if (changes.settings) {
      settings = withDefaults(changes.settings.newValue);
      applyMode();
      if (settings.enabled) {
        scan();
        retryPending();
      } else {
        banner(null);
      }
    }
    if (changes.verdicts) {
      if (changes.verdicts.newValue) {
        if (merge(changes.verdicts.newValue))
          for (const card of pendingCards()) resolve(card, card.dataset.hpwId);
      } else {
        verdicts.clear();
        attempts.clear();
        resetCards();
        scheduleScan();
      }
    }
  }

  safeChrome(() =>
    chrome.storage.local.get(["settings", "verdicts", "rules"]).then((got) => {
      settings = { ...DEFAULTS, ...(got.settings || {}) };
      if (got.rules === RULES) {
        merge(got.verdicts);
      } else {
        chrome.storage.local.set({ rules: RULES, verdicts: { members: "", paid: "", ok: {} } });
      }
      applyMode();
      scan();
    }),
  );

  try {
    chrome.storage.onChanged.addListener(onStorageChanged);
    chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
      if (msg?.type === "hpw-report") reply(report());
    });
  } catch {
    alive = false;
  }

  // Ignore the video player, which updates many times a second while playing.
  function onMutations(records) {
    if (scanTimer) return;
    for (const r of records) {
      if (r.type === "attributes") return scheduleScan();
      if (!hasElement(r.addedNodes)) continue;
      if (r.target.closest?.(".html5-video-player")) continue;
      return scheduleScan();
    }
  }

  function hasElement(nodes) {
    for (const n of nodes) if (n.nodeType === 1) return true;
    return false;
  }

  new MutationObserver(onMutations).observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["href"],
  });
  window.addEventListener("yt-navigate-finish", scheduleScan);
  window.addEventListener("popstate", scheduleScan);
  document.addEventListener("DOMContentLoaded", scheduleScan);

  setInterval(() => {
    if (settings.enabled && alive && openVideo()) checkOpenVideo();
  }, 1000);

  window.addEventListener("pagehide", () => {
    if (saveTimer) saveNow();
  });
})();
