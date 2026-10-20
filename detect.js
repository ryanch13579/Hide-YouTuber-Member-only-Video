/*
 * Works out whether a video page's HTML belongs to a video behind a paywall,
 * and which kind:
 *
 *   "members"  members-only (join a channel to watch), incl. "Members first"
 *   "paid"     anything else paid: movies and shows to buy or rent,
 *              pay-per-view events
 *
 * "ypc" is YouTube's internal name for all paid content. It is also what the
 * player's debug info reports as  "prerolls": "ypc".  Feed thumbnails don't
 * always show it, but the video's own page does, in two places:
 *
 *   ytInitialPlayerResponse  "playabilityStatus":{ ... "ypcOfferRenderer" ... }
 *     For viewers who haven't paid, the player is replaced by an offer:
 *     "join this channel", "buy or rent", and so on. Every kind of paid
 *     content has one; a "ypcTrailerRenderer" means a movie or show.
 *
 *   ytInitialData  "videoPrimaryInfoRenderer":{ ... "BADGE_STYLE_TYPE_MEMBERS_ONLY" ... }
 *     The "Members only" badge under the title, shown to everyone. This is
 *     what tells a members-only video apart from other paid content.
 *
 * Matching JSON keys rather than visible text makes this work in every
 * language. If YouTube renames them, CHECKS is the one thing to update.
 */
(function (root) {
  "use strict";

  // Key names such as "ypcOfferRenderer" or "playerLegacyDesktopYpcOfferRenderer".
  const YPC_RE = /"\w*[yY]pc\w*Renderer":/;
  const TRAILER_RE = /"\w*[yY]pcTrailerRenderer":/;
  // BADGE_STYLE_TYPE_MEMBERS_ONLY, and any sibling such as …_MEMBERS_FIRST.
  const MEMBERS_RE = /"BADGE_STYLE_TYPE_MEMBERS_\w+"/;

  // Each check returns "members" or "paid" when sure, "ypc" for "paid, kind
  // not known yet", or "" for nothing found.
  // The trailing ":{" matters: bare keys also appear in lists of component
  // names on the page, which must not count as a match. Each check looks only
  // inside one object, so badges on sidebar recommendations aren't mistaken
  // for the open video's.
  const CHECKS = [
    {
      marker: '"playabilityStatus":{',
      limit: 50000,
      judge: (section) =>
        !YPC_RE.test(section) ? "" : TRAILER_RE.test(section) ? "paid" : "ypc",
    },
    {
      marker: '"videoPrimaryInfoRenderer":{',
      limit: 400000,
      judge: (section) => (MEMBERS_RE.test(section) ? "members" : ""),
    },
  ];

  /** Returns the JSON object starting at text[start] === "{", or null if it does not close within limit. */
  function objectAt(text, start, limit) {
    const stop = Math.min(text.length, start + limit);
    let depth = 0;
    let inString = false;
    for (let i = start; i < stop; i++) {
      const c = text.charCodeAt(i);
      if (inString) {
        if (c === 92)
          i++; // backslash: skip the escaped character
        else if (c === 34) inString = false;
      } else if (c === 34) inString = true;
      else if (c === 123) depth++;
      else if (c === 125 && --depth === 0) return text.slice(start, i + 1);
    }
    return null;
  }

  const DATA_START = "var ytInitialData";
  const DATA_HINT = "ytInitialData";
  const SCRIPT_END = "</script>";

  /**
   * Incremental scanner. Feed it text as it downloads; only a short tail is
   * kept between chunks (or an unfinished section), so memory stays small.
   * push()/end() return: "members" or "paid", false (video page, free),
   * undefined (not a video page), or null (need more data).
   */
  function createScanner() {
    const KEEP =
      Math.max(
        ...CHECKS.map((c) => c.marker.length),
        DATA_START.length,
        SCRIPT_END.length,
      ) - 1;
    let tail = ""; // unprocessed end of the previous chunk
    let base = 0; // absolute offset of tail[0] in the document
    let dataAt = -1; // absolute offset of "var ytInitialData"
    const judgedUpTo = CHECKS.map(() => 0); // per check: markers before this offset are judged
    let sawData = false;
    let sawYpc = false; // paid, but not yet known whether members-only

    function step(chunk, final) {
      const text = tail + chunk;
      if (!sawData && text.includes(DATA_HINT)) sawData = true;
      if (dataAt === -1) {
        const i = text.indexOf(DATA_START);
        if (i !== -1) dataAt = base + i;
      }
      // Both signals come before the end of the ytInitialData script, so once
      // that script has closed without a match we can stop downloading.
      const dataEnd =
        dataAt === -1
          ? -1
          : text.indexOf(SCRIPT_END, Math.max(0, dataAt - base));

      let keepFrom = Math.max(0, text.length - KEEP);
      let waiting = false;
      let found = "";
      CHECKS.forEach((check, n) => {
        if (found) return;
        let from = Math.max(0, judgedUpTo[n] - base);
        for (;;) {
          const i = text.indexOf(check.marker, from);
          if (i === -1 || (dataEnd !== -1 && i > dataEnd)) break;
          const open = i + check.marker.length - 1;
          let section = objectAt(text, open, check.limit);
          if (section === null) {
            if (!final && text.length < open + check.limit) {
              keepFrom = Math.min(keepFrom, i); // hold on to it until the rest arrives
              waiting = true;
              break;
            }
            section = text.slice(open, open + check.limit);
          }
          const kind = check.judge(section);
          if (kind === "ypc") sawYpc = true;
          else if (kind) {
            found = kind;
            return;
          }
          from = i + check.marker.length;
          judgedUpTo[n] = base + from;
        }
      });

      // A paid video that never showed a members badge is "paid".
      const verdict = sawYpc ? "paid" : false;
      if (found) return found;
      if (!waiting && dataEnd !== -1) return verdict;
      if (final) return sawData ? verdict : undefined;
      tail = text.slice(keepFrom);
      base += keepFrom;
      return null;
    }

    return {
      push: (text) => step(text, false),
      end: () => step("", true),
    };
  }

  function scanAll(scanner, text) {
    const result = scanner.push(text);
    return result === null ? scanner.end() : result;
  }

  /** Whole-string version, handy for tests. */
  const htmlIsPaid = (html) => scanAll(createScanner(), html);

  /** Reads a fetch Response as a stream and stops as soon as the answer is known. */
  async function readResponse(res) {
    const scanner = createScanner();
    if (!res.body) return scanAll(scanner, await res.text());

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const result = scanner.push(decoder.decode(value, { stream: true }));
      if (result !== null) {
        reader.cancel().catch(() => {});
        return result;
      }
    }
    return scanner.end();
  }

  const api = { CHECKS, createScanner, htmlIsPaid, readResponse };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HPW_DETECT = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
