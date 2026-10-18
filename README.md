# Hide YouTube Members-Only Videos

A Chrome extension that removes YouTube's **members-only** videos (the ones
you have to join a channel to watch).

It removes them from the home feed, subscriptions, search results, the
watch-page sidebar, channel pages and Shorts shelves, and skips them in the
Shorts player.

![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue)
![Version](https://img.shields.io/badge/version-1.0.0-green)

## Features

- **Removes, doesn't highlight**: members-only videos simply disappear.
- **Shorts skipping**: members-only Shorts are skipped automatically.
- **Fast**: cards already showing YouTube's "Members only" badge vanish
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

## Usage

Click the toolbar icon to:

- turn the filter on or off
- see how many videos have been checked and how many were members-only
- see whether the open video or Short is members-only
- see warnings, such as YouTube refusing checks
- clear the cache with **Clear saved results**

## How it works

Two layers:

1. **Badge on the card.** Where YouTube shows a "Members only" badge on a
   thumbnail (`.badge-style-type-members-only`), CSS removes the card at once.
2. **The video's own page.** For every other card, the extension fetches the
   video's page in the background and looks for either signal:
   - a `ypc…Renderer` (YouTube's internal name for paid content, the same
     thing the player's debug info reports as `"prerolls": "ypc"`) inside
     `playabilityStatus`, which is the "join this channel" offer non-members see;
   - `BADGE_STYLE_TYPE_MEMBERS_ONLY` inside `videoPrimaryInfoRenderer`, the
     badge under the title, which members see too.

Up to 6 checks run at once. Cards near the screen go first. Members-only
results are kept permanently; public ones are re-checked after 7 days.

| File | Role |
| --- | --- |
| `manifest.json` | Extension manifest (MV3). |
| `detect.js` | Finds the members-only signals in a page's data (`CHECKS`). |
| `content.js` | Finds video cards, queues and caches checks, marks cards and skips members-only Shorts. |
| `content.css` | Removes marked cards and cards with a members-only badge. |
| `popup.html` / `popup.js` | The toolbar popup. |
| `icons/` | Extension icons. |

## Limitations

- **First check can flash.** A card without a visible badge stays until its
  check finishes. Cached videos are removed immediately.
- **Paid content in general.** Other paywalled videos (such as rented
  movies) use the same `ypc` mechanism and may also be removed.
- **Rate limits.** If YouTube answers "too many requests", the extension
  pauses and retries later.
- **Direct links still open.** Only thumbnails are removed; members-only
  Shorts are skipped.
- **Playlists and mixes** are not filtered.

## Troubleshooting

- **Nothing is removed.** YouTube has probably renamed a key. Open a
  members-only video, view the page source and update `CHECKS` in `detect.js`.
- **Badged cards flash before disappearing.** The badge class has changed;
  update the selector in `content.css`.
- **Members-only Shorts aren't skipped.** Update `shortsNext` in the `CFG`
  block at the top of `content.js`.

## Privacy

**What the extension handles:** video links on `youtube.com` pages, each
video's YouTube page (to check whether it is members-only), a local cache of
checked video IDs (up to 10,000, about 110 KB), and whether the filter is on.

**Where it is stored:** only in your browser (`chrome.storage.local`).
Nothing is sent to the developer or any third party. The only network
requests go to `youtube.com`.

**Permissions:** only `storage`. Content scripts run only on
`https://www.youtube.com/*`.

**Your control:** **Clear saved results** in the popup clears the cache.
Removing the extension deletes everything it stored.

## Disclaimer

This project is not affiliated with or endorsed by YouTube or Google.
