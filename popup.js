'use strict';

const DEFAULTS = { enabled: true, members: true, paid: true };
const KINDS = ['members', 'paid'];
const $ = (id) => document.getElementById(id);
const kindBoxes = document.querySelectorAll('input[data-kind]');

let settings = { ...DEFAULTS };

// ---- Settings and totals ----------------------------------------------------

function renderSettings() {
  $('enabled').checked = settings.enabled;
  $('kinds').disabled = !settings.enabled;
  for (const box of kindBoxes) box.checked = settings[box.dataset.kind];
  // Only show the counter for kinds that are being hidden.
  for (const kind of KINDS) $(kind).closest('.stat').hidden = !settings[kind];
}

// verdicts is { members: "id1…", paid: "id2…", ok: { "<day>": "id3id4…" } },
// made of back-to-back 11-character video ids.
function renderCounts(verdicts = {}) {
  let total = 0;
  for (const kind of KINDS) {
    const n = typeof verdicts[kind] === 'string' ? verdicts[kind].length / 11 : 0;
    $(kind).textContent = n.toLocaleString();
    total += n;
  }
  for (const ids of Object.values(verdicts.ok || {})) total += ids.length / 11;
  $('total').textContent = total.toLocaleString();
}

function save() {
  chrome.storage.local.set({ settings });
  renderSettings();
}

chrome.storage.local.get(['settings', 'verdicts']).then((got) => {
  settings = { ...DEFAULTS, ...got.settings };
  renderSettings();
  renderCounts(got.verdicts);
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.verdicts) renderCounts(changes.verdicts.newValue);
});

$('enabled').addEventListener('change', (e) => {
  settings.enabled = e.target.checked;
  save();
});

for (const box of kindBoxes) {
  box.addEventListener('change', () => {
    settings[box.dataset.kind] = box.checked;
    save();
  });
}

$('clear').addEventListener('click', () => chrome.storage.local.remove('verdicts'));

// ---- What the extension is doing in the current tab ------------------------

// [message, colour of the "This tab" box] for each state of the open video.
function describeOpenVideo(v, hiding) {
  const name = { members: 'Members-only', paid: 'Paid movie or show' }[v.label];
  if (name && !hiding[v.label]) return [`${name} · shown (option off)`, 'info'];
  const action = v.kind === 'shorts' ? 'skipped' : 'hidden from feeds';
  return {
    members: [`${name} · ${action}`, 'alert'],
    paid: [`${name} · ${action}`, 'alert'],
    free: ['Free to watch', 'good'],
    checking: ['Checking…', 'info'],
    unknown: ['Not checked yet', 'info'],
  }[v.label];
}

function describeProblem(r) {
  const l = r.lookups;
  if (l.pausedSeconds) return `YouTube is limiting checks · retrying in ${l.pausedSeconds}s`;
  if (l.failed && !l.answered) return `Checks failing: ${l.lastError}`;
  if (r.shorts.skipStuck) return 'Couldn\'t skip this Short';
  if (!r.cards && r.strayLinks > 5) return 'Thumbnails not recognised';
  return '';
}

function renderPage(r) {
  const page = $('page'), title = $('page-title'), main = $('page-main'), video = $('page-video'), warn = $('page-warn');
  const open = r && r.openVideo;
  title.textContent = !r ? 'Not active' : !open ? 'This tab' : open.kind === 'shorts' ? 'This Short' : 'This video';

  if (!r) {
    page.hidden = main.hidden = false;
    page.dataset.tone = 'warn';
    main.textContent = 'Open YouTube, or refresh this tab.';
    video.hidden = warn.hidden = true;
    return;
  }

  let tone = 'info';
  main.textContent = 'No videos on this page';
  main.hidden = !!r.cards || !!open;

  video.hidden = !open;
  if (open) [video.textContent, tone] = describeOpenVideo(open, r.hiding);

  const problem = describeProblem(r);
  warn.hidden = !problem;
  warn.textContent = problem;
  if (problem) tone = 'warn';

  page.dataset.tone = tone;
  page.hidden = main.hidden && video.hidden && warn.hidden;
}

async function refreshPage() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    renderPage(await chrome.tabs.sendMessage(tab.id, { type: 'hpw-report' }));
  } catch {
    renderPage(null);
  }
}

refreshPage();
setInterval(refreshPage, 1000);
