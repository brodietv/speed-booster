<p align="center">
  <img src="icons/icon-128.png" width="96" height="96" alt="Speed Booster">
</p>

<h1 align="center">Speed Booster for ChatGPT</h1>

<p align="center">
  <b>Long ChatGPT chats open instantly and stay smooth</b> — plus wide mode, an outline with whole-chat search,
  a prompt library, one-click PDF/Markdown export, timestamps and keyboard shortcuts.<br>
  Free, no limits, no accounts, and it never sends your data anywhere.
</p>

---

## Why

ChatGPT downloads a whole conversation and builds every message on the page. Once a chat gets long, it takes
seconds to open and typing starts to lag. Speed Booster steps in **before** ChatGPT renders anything and hands it
only the most recent messages. The full conversation stays on OpenAI's servers, so **ChatGPT still remembers
everything**. Your browser just stops drawing thousands of messages you aren't reading.

## Features

### ⚡ Speed
- **Instant long chats** — only the last *N* messages are rendered (default 30, adjustable from 2 to 500).
- **Works with both of ChatGPT's loaders.**
  - Classic loader: the conversation download is trimmed before React sees it.
  - Newer page-by-page loader: older pages load as you scroll up, and are **paused** once you have enough on screen.
- **Load more / Show all** whenever you want history back. With the page-by-page loader this resumes in place
  with no page reload.
- **Safety net** — if ChatGPT ever changes its API, old turns are collapsed in the page instead, so chats stay fast.
- **Render boost** for older layouts: off-screen messages skip layout and paint entirely.

### 🧭 Navigate & search
- **Outline panel** (<kbd>Alt</kbd>+<kbd>J</kbd>) lists *every* prompt in the chat, including ones hidden for speed,
  and highlights where you are. Click a hidden prompt and it loads just enough history to jump straight to it.
- **Search the whole chat** — prompts *and* answers, including messages that were never loaded.
- **Jump between prompts** with <kbd>Alt</kbd>+<kbd>↑</kbd> / <kbd>Alt</kbd>+<kbd>↓</kbd>.

### ✨ Prompt library & command palette
- **Command palette** (<kbd>Alt</kbd>+<kbd>K</kbd>) — every action and prompt, fuzzy-searchable.
- **Prompt library** (<kbd>Alt</kbd>+<kbd>P</kbd>) with 14 carefully written starter prompts (summarize, code review,
  debug, fact-check, critique, translate…).
- **Fill-in blanks**: write `{{topic}}` or `{{language:Spanish}}` (with a default) and you get a small form each time.
  `{{selection}}`, `{{date}}` and `{{time}}` fill themselves in.
- <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Enter</kbd> **inserts and sends** in one go. Most-used prompts float to the top.
- Save whatever is in the message box as a prompt. Manage, import and export prompts on the settings page.

### 📤 Export — free, unlimited, no watermark
- **Markdown**, **PDF** (clean print view), **web page (HTML)**, **JSON**, **plain text**, or **copy as Markdown**.
- Exports fetch the complete conversation fresh from ChatGPT, so they include every message, even ones hidden
  for speed.

### 📖 Reading comfort
- **Wide mode** with an adjustable width, up to full screen. It previews live as you drag the slider.
- **Timestamps & model badges** on every message ("2:14 PM · GPT-5 Thinking").
- **Live word & token counter** while you type, and a token estimate for the whole chat. When a chat gets long
  enough to lose early details, it offers a hand-off summary prompt.
- Matches ChatGPT's light and dark themes.

## How it compares

|                                                          | Speed Booster (this) | Typical "speed booster" extensions |
| -------------------------------------------------------- | :------------------: | :--------------------------------: |
| Trims long chats before they render                      |          ✅          |               varies               |
| Handles ChatGPT's 2026 page-by-page loading & virtualized turns |    ✅          |       many predate it              |
| Load more **without** reloading (paged loader)           |          ✅          |                 ❌                 |
| Outline including hidden prompts, jump-to-hidden         |          ✅          |                rare                |
| Search messages that were never loaded                   |          ✅          |                rare                |
| Export PDF / MD / HTML / JSON / TXT                      |  ✅ free, unlimited  |   often limited or watermarked     |
| Prompt library with fill-in variables                    |          ✅          |                 ❌                 |
| Talks to servers other than chatgpt.com                  |       ❌ never       |               varies               |
| Daily limits, paywall, account                           |          ❌          |               common               |

## Install

### Chrome, Edge, Brave, Arc, Opera, Vivaldi
1. Download this repository (**Code → Download ZIP**) and unzip it, or run `npm run build` and unzip
   `dist/speed-booster-chrome-v2.0.0.zip`.
2. Open `chrome://extensions` (or `edge://extensions`) and turn on **Developer mode**.
3. Click **Load unpacked** and select the folder that contains `manifest.json`.
4. Reload any open ChatGPT tabs. You'll see the ⚡ dock on the right.

### Firefox (128+)
1. Run `npm run build` (needs Node.js 18+).
2. Open `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → pick `dist/firefox/manifest.json`.
3. If Firefox asks, allow the add-on to access chatgpt.com (Extensions menu → Speed Booster → *Always allow*).

To publish permanently, upload `dist/speed-booster-firefox-v2.0.0.zip` to addons.mozilla.org, or
`dist/speed-booster-chrome-v2.0.0.zip` to the Chrome Web Store.

## Using it

| Shortcut (⌥ on Mac)            | Action                                           |
| ------------------------------ | ------------------------------------------------ |
| <kbd>Alt</kbd>+<kbd>K</kbd>    | Command palette                                  |
| <kbd>Alt</kbd>+<kbd>P</kbd>    | Prompt library                                   |
| <kbd>Alt</kbd>+<kbd>J</kbd>    | Outline & whole-chat search                      |
| <kbd>Alt</kbd>+<kbd>W</kbd>    | Toggle wide mode                                 |
| <kbd>Alt</kbd>+<kbd>↑</kbd> / <kbd>↓</kbd> | Previous / next prompt              |
| <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Enter</kbd> | In the palette: insert prompt **and send** |

Shortcuts match the physical key, so they work on any keyboard layout. They avoid ChatGPT's own shortcuts and
browser menus, and can be turned off in settings. The toolbar popup shows live stats for the open chat and the
most-used settings. Everything else, including the prompt manager, is on the settings page.

## Privacy

- **No data leaves your browser.** No analytics, no telemetry, no accounts, no ads, no remote code.
- Settings and prompts live in your browser's extension storage.
- The only network requests Speed Booster makes go to `chatgpt.com`, from your own tab and signed in as you.
  These are the same requests ChatGPT makes itself (for example, to fetch the full chat for export or search).
  Your access token never leaves the page.
- Permissions: `storage`, plus access to `chatgpt.com` / `chat.openai.com`. That's all.

## How it works

```
 ChatGPT page ──fetch──▶ [src/inject/interceptor.js]  (page's MAIN world, runs before ChatGPT's code)
                           • classic loader: trims the conversation tree to the last N turns
                           • paged loader: counts loaded turns, parks older-page requests past the budget
                           • reports stats, prompt list and timestamps ──postMessage──┐
                                                                                        ▼
 [src/content/*]  (isolated content scripts: dock, outline, palette, export, timestamps, shortcuts)
 [src/popup, src/options]  (toolbar popup, settings & prompt library)
 [src/background]  (opens settings / the PDF print view)
```

- **Fail-safe by design.** Anything unexpected, such as an unknown response shape, a network error or an
  inconsistent tree, returns ChatGPT's original response untouched. Deep links (`?message=`) and temporary chats
  are never trimmed.
- **Trimming never splits a turn.** It keeps hidden system/context nodes, every branch below the cut, and the
  first visible prompt's real parent (as a hidden node). That keeps message versions (`< 2/3 >`), editing and tool
  confirmations working.
- **One file knows ChatGPT's DOM** ([`src/content/chatgpt.js`](src/content/chatgpt.js)), with fallbacks for
  older markup. That makes a redesign a one-file fix.
- **Virtualization-aware.** ChatGPT only mounts the turns near your screen, so the outline and search work from
  the conversation data, not the page. Jumping to a prompt that isn't mounted scrolls it into existence first.
- Our UI lives in a Shadow DOM, so it never fights ChatGPT's styles. Timestamps are drawn with CSS `attr()`, so
  React's DOM is never restructured.
- ChatGPT re-requests open chats every few seconds. Identical payloads are recognised and not re-processed.

## Development

```bash
npm install            # dev dependency: Playwright (for tests and icon rendering)
npm test               # unit tests (node:test) — trimming, paging, export formats, markdown, prompts, settings
npm run test:e2e       # loads the real extension in Chromium against a mock ChatGPT (both loaders, 3 layouts)
npm run build          # dist/chrome, dist/firefox and store-ready zips
npm run icons          # re-render icons/*.png from icons/icon.svg
```

There's no build step for development. Load the repository folder unpacked, edit, and hit reload on
`chrome://extensions`.

```
manifest.json            Chrome/Edge manifest (the build derives the Firefox one)
src/inject/              page-level network layer (trimming, paging, full-chat fetch)
src/content/             in-page features, one file each; chatgpt.js holds every selector
src/shared/              settings schema, prompt library, export formats, markdown renderer
src/popup, src/options   toolbar popup, settings page & prompt manager
src/print, src/background PDF print view, background worker
tests/unit, tests/e2e    node:test suites; tests/e2e/mock is a stand-in ChatGPT
```

## Troubleshooting

- **Nothing shows up:** reload the ChatGPT tab after installing or updating the extension.
- **Something looks off after a ChatGPT update:** flip the master switch in the toolbar popup to get stock ChatGPT
  back instantly. Every feature fails safe, so ChatGPT keeps working even if one stops.
- **I want everything back for one chat:** click **Show all** in the pill at the top of the chat, or in the ⚡ menu.
- **Firefox shows no dock:** make sure the add-on is allowed to run on chatgpt.com (Extensions menu).
