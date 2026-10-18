/*
 * Detects whether a video page's HTML belongs to a members-only video.
 *
 * Feed thumbnails don't always carry the "Members only" badge, but the
 * video's own page always does, in two places:
 *
 *   ytInitialPlayerResponse  "playabilityStatus":{ ... "ypcOfferRenderer" ... }
 *     For viewers who aren't members, the player is replaced by a "join this
 *     channel" offer. "ypc" is YouTube's internal name for paid content; it is
 *     also what the player's debug info reports as  "prerolls": "ypc".
 *
 *   ytInitialData  "videoPrimaryInfoRenderer":{ ... "BADGE_STYLE_TYPE_MEMBERS_ONLY" ... }
 *     The "Members only" badge under the title, shown to members too.
 *
 * Matching JSON keys rather than visible text makes this work in every
 * language. If YouTube renames them, CHECKS is the one thing to update.
 */
(function (root) {
  "use strict";

  // Key names such as "ypcOfferRenderer" or "playerLegacyDesktopYpcOfferRenderer".
  const YPC_RE = /"\w*[yY]pc\w*Renderer":/;
  const MEMBERS_BADGE = '"BADGE_STYLE_TYPE_MEMBERS_ONLY"';

  // The trailing ":{" matters: bare keys also appear in lists of component
  // names on the page, which must not count as a match. Each check looks only
  // inside one object, so badges on sidebar recommendations aren't mistaken
  // for the open video's.
  const CHECKS = [
    {
      marker: '"playabilityStatus":{',
      limit: 50000,
      test: (section) => YPC_RE.test(section),
    },
    {
      marker: '"videoPrimaryInfoRenderer":{',
      limit: 400000,
      test: (section) => section.includes(MEMBERS_BADGE),
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
   * push()/end() return: true (members-only), false (video page, not
   * members-only), undefined (not a video page), or null (need more data).
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
      CHECKS.forEach((check, n) => {
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
          if (check.test(section)) {
            waiting = "found";
            return;
          }
          from = i + check.marker.length;
          judgedUpTo[n] = base + from;
        }
      });

      if (waiting === "found") return true;
      if (!waiting && dataEnd !== -1) return false;
      if (final) return sawData ? false : undefined;
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
  const htmlIsMembersOnly = (html) => scanAll(createScanner(), html);

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

  const api = { CHECKS, createScanner, htmlIsMembersOnly, readResponse };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HMO_DETECT = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
