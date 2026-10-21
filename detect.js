// Reads a video page's HTML and answers "members" (members-only), "paid"
// (movies, shows, pay-per-view) or false (free). "ypc" is YouTube's internal
// name for paid content. If YouTube renames its keys, update CHECKS.
(function (root) {
  "use strict";

  const YPC_RE = /"\w*[yY]pc\w*Renderer":/;
  const TRAILER_RE = /"\w*[yY]pcTrailerRenderer":/;
  const MEMBERS_RE = /"BADGE_STYLE_TYPE_MEMBERS_\w+"/;

  // The trailing ":{" skips bare key names listed elsewhere on the page, and each
  // check looks inside one object only, so sidebar videos can't flag this one.
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

    function objectAt(text, start, limit) {
    const stop = Math.min(text.length, start + limit);
    let depth = 0;
    let inString = false;
    for (let i = start; i < stop; i++) {
      const c = text.charCodeAt(i);
      if (inString) {
        if (c === 92)
          i++;
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

    function createScanner() {
    const KEEP =
      Math.max(
        ...CHECKS.map((c) => c.marker.length),
        DATA_START.length,
        SCRIPT_END.length,
      ) - 1;
    let tail = "";
    let base = 0;
    let dataAt = -1;
    const judgedUpTo = CHECKS.map(() => 0);
    let sawData = false;
    let sawYpc = false;

    function step(chunk, final) {
      const text = tail + chunk;
      if (!sawData && text.includes(DATA_HINT)) sawData = true;
      if (dataAt === -1) {
        const i = text.indexOf(DATA_START);
        if (i !== -1) dataAt = base + i;
      }
      // Both signals sit inside ytInitialData, so stop once that script has closed.
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
              keepFrom = Math.min(keepFrom, i);
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

    const htmlIsPaid = (html) => scanAll(createScanner(), html);

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
