# Hide Paid YouTube Videos

A Chrome extension that removes YouTube videos you'd have to **pay** to
watch:

- **Members-only** videos (join a channel to watch), including "Members
  first" early access
- **Movies and shows** to buy or rent
- **Pay-per-view** events and other paid content

It removes them from the home feed, subscriptions, search results, the
watch-page sidebar, channel pages and Shorts shelves, and skips them in the
Shorts player.

![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue)
![Version](https://img.shields.io/badge/version-1.1.0-green)

## Features

- **You choose what to hide**: members-only videos and paid movies & shows
  each have their own switch.
- **Removes, doesn't highlight**: hidden videos simply disappear, and the
  videos around them close up so there are no gaps.
- **Shorts skipping**: paid Shorts are skipped automatically.
- **Fast**: cards already showing a "Members only" or price badge vanish
  immediately; the rest are checked as soon as they load.
- **Any language**: detection uses YouTube's page data, not visible text.
- **Private**: no accounts, no analytics, no outside servers. See
  [Privacy](#privacy).

## Install

1. Clone the repository, or download it as a ZIP and unzip it somewhere
   permanent.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the project folder.
4. Open or refresh YouTube.

After editing any file, click the reload arrow ↻ on the extension's card in
`chrome://extensions`, then refresh YouTube. (Changes to the popup only need
the reload.)

## Usage

Click the toolbar icon to open the popup:

| Part | What it does |
| --- | --- |
| Switch next to **Hide Paid Videos** | Turns the whole filter on or off. |
| **What to hide** | A switch each for **Members-only videos** and **Paid movies & shows**. Changes apply instantly, no refresh needed. |
| Counters | How many members-only and paid videos were found, and how many videos were checked. A counter is hidden while its kind is switched off. |
| **This tab** box | Whether the open video or Short is members-only, paid or free, colour-coded: red (hidden), green (free), blue (checking), amber (a problem, such as YouTube refusing checks). Shown only when there's something to report. |
| **Clear saved results** | Clears the cache so every video is checked again. |

## How it works

"ypc" is YouTube's internal name for all paid content: memberships, movie
purchases and rentals, pay-per-view. It is the same thing the player's debug
info reports as `"prerolls": "ypc"`. The extension looks for it in two layers:

1. **Badge on the card.** Where a thumbnail shows a "Members only" badge
   (`.badge-style-type-members-only`) or a price / "Buy or rent" badge
   (`.badge-style-type-ypc`), CSS removes the card at once.
2. **The video's own page.** For every other card, the extension fetches the
   video's page in the background and looks for:
   - a `ypc…Renderer` inside `playabilityStatus`: the "join this channel" or
     "buy or rent" offer shown to anyone who hasn't paid;
   - a `BADGE_STYLE_TYPE_MEMBERS_…` badge (members only, members first)
     inside `videoPrimaryInfoRenderer`: the badge under the title, which
     members see too.

Each paid video is then sorted into one of the two kinds the popup lets you
switch:

| Kind | How it's recognised |
| --- | --- |
| **Members-only** | Has the members badge under the title. |
| **Paid movies & shows** | Has a paid offer but no members badge, e.g. a `ypcTrailerRenderer` (movie trailer + buy/rent) or a pay-per-view offer. |

Up to 6 checks run at once. Cards near the screen go first. Paid results are
kept permanently, along with their kind; free ones are re-checked after 7
days, since a video can be put behind a paywall later.

| File | Role |
| --- | --- |
| `manifest.json` | Extension manifest (MV3). |
| `detect.js` | Finds the paid-content signals in a page's data (`CHECKS`). |
| `content.js` | Finds video cards, queues and caches checks, marks cards and skips paid Shorts. |
| `content.css` | Removes marked cards and cards with a paid badge (per kind), and closes the gaps in grids. |
| `popup.html` / `popup.js` | The toolbar popup. Colours are CSS variables at the top of `popup.html`. |
| `icons/` | Extension icons: a play button with a "no $" badge (16 px is a simplified "no $" sign). |

## Limitations

- **First check can flash.** A card without a visible badge stays until its
  check finishes. Cached videos are removed immediately.
- **Movies you already bought** may still be hidden in feeds, if their card
  shows a paid badge.
- **YouTube Premium-only content** (such as some YouTube Originals) uses a
  different mechanism and is not filtered.
- **Ads and sponsored segments** aren't paywalls, so they aren't touched.
- **Rate limits.** If YouTube answers "too many requests", the extension
  pauses and retries later.
- **Direct links still open.** Only thumbnails are removed; paid Shorts are
  skipped.
- **Playlists and mixes** are not filtered.

## Troubleshooting

- **Nothing is removed.** YouTube has probably renamed a key. Open a paid
  video, view the page source and update `CHECKS` in `detect.js`.
- **Badged cards flash before disappearing.** The badge class has changed;
  update the selector in `content.css`.
- **Movie cards aren't removed on some page.** Inspect the card and add its
  tag name to `outerCards` in the `CFG` block at the top of `content.js`.
- **Paid Shorts aren't skipped.** Update `shortsNext` in `CFG`.

## Privacy

**What the extension handles:** video links on `youtube.com` pages, each
video's YouTube page (to check whether it is paid), a local cache of checked
video IDs and their kind (up to 10,000, about 110 KB), and your settings
(whether the filter is on, and which kinds to hide).

**Where it is stored:** only in your browser (`chrome.storage.local`).
Nothing is sent to the developer or any third party. The only network
requests go to `youtube.com`.

**Permissions:** only `storage`. Content scripts run only on
`https://www.youtube.com/*`.

**Your control:** **Clear saved results** in the popup clears the cache.
Removing the extension deletes everything it stored.

## Disclaimer

This project is not affiliated with or endorsed by YouTube or Google.
