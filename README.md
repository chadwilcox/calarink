# Calarink

<img src="public/logo.svg" width="64" alt="Calarink logo">

Pulls public skate, stick & puck, shinny/pickup, and freestyle ice times from ice rinks and shows them in one filterable list. Live at **https://calarink.com**, one page per US state (`/maine`, `/colorado`, `/new-york`, …) and Canadian province (`/ontario`, `/quebec`, `/british-columbia`, …).

## Run it

Double-click `start.cmd`, or:

```
npm install
npm start
```

Then open http://localhost:5178. The server listens on `127.0.0.1` only. Set `HOST=0.0.0.0` to reach it from other devices on your network, or `PORT=xxxx` to change the port.

## Published site (calarink.com)

GitHub Pages serves the site at calarink.com; the domain is registered with Cloudflare, whose DNS points at GitHub (records set to DNS only). `.github/workflows/publish.yml` runs `npm run build` every 30 minutes, on every push to `main`, and on demand (Actions tab → Publish → Run workflow). The build pulls every rink once and writes `dist/`: the page, `schedule.json`, and a copy of the page for each state (`dist/maine/index.html`). The published page has no Refresh button; it re-reads `schedule.json` every 10 minutes.

- **Visitor's state or province (Cloudflare Worker):** calarink.com is proxied through Cloudflare (orange cloud; SSL mode must not be Flexible or GitHub's HTTPS redirect loops). The Worker in [worker/](worker/) adds `<meta name="visitor-region" content="ME">` to each page from Cloudflare's own location data, so a first-time visitor opens their state. A state in the address or the visitor's last pick still wins. Deploy changes with `npx wrangler deploy` from `worker/` (needs `npx wrangler login`).
- GitHub renews its HTTPS certificate for calarink.com through the Cloudflare proxy; the current one expires 2026-12-24. If the site ever shows a certificate error after that, check Settings → Pages in the repo.
- A rink whose site fails keeps its last good copy (the workflow carries `data/` between runs). If every rink fails, the run stops and the old site stays up.
- GitHub can start scheduled runs late when it's busy, and pauses them after 60 days with no commits. Re-enable from the Actions tab.

## Phone and tablet app

calarink.com installs as an app (a progressive web app): it opens full screen from a home-screen icon and keeps the last schedules it loaded, so it still opens with a weak signal at the rink. There's no app store listing.

A floating **Free Mobile App** button shows on phones and tablets that don't have it installed yet (not on computers):

- **iPhone / iPad:** the button shows the steps: in Safari, Share (under ••• on newer iPhones) → Add to Home Screen.
- **Android:** the button opens Chrome's install prompt. Chrome only offers it when the app isn't installed.
- **Inside Facebook, Instagram, Messenger, TikTok and other apps' built-in browsers:** those can't install an app, so the button explains how to open Calarink in Safari or Chrome, with an **Open in Safari/Chrome** link that does it where the app allows (an `intent://` link on Android, `x-safari-https://` on iPhone). The in-app browser is spotted from its user agent (`FBAN`, `FBAV`, `Instagram`, …).

[public/manifest.webmanifest](public/manifest.webmanifest) names the app and its icons ([public/icons/](public/icons/), rendered from `logo.svg`). [public/sw.js](public/sw.js) is the service worker: build-stamped files (`app.js?v=…`) come from its cache; the page, `schedule.json` and each state's sessions come from the network, with the last good copy saved for offline. When the page is showing saved copies, it says so. Installed apps update themselves: the next time one opens online it gets the latest page and schedules.

**Sessions:** tapping a session opens its details: Share (the phone's share sheet, or copy the link on a computer), add to Apple/Outlook (.ics) or Google Calendar, the rink's schedule page, and directions. Each session has its own link, `calarink.com/<state>/?event=<id>`, which opens those details; the id is the rink, start time and a hash of the title (`usm-gorham.20261003T1700.k3f9`), so it holds as long as the session does. A link to a session that's gone points to the rink instead. Shared links preview with the Calarink name and icon (Open Graph tags in `index.html`).

**Counts:** [calarink.goatcounter.com](https://calarink.goatcounter.com) (free, no cookies). Page views are counted per state page (`/maine/`); picking a state counts as a view of that state's page. Events: `app-opened` (launched from a home screen), `app-installed` (the first launch on a device; the installed app keeps its own storage, so this works on iPhones too), and `app-button-tapped` (the Free Mobile App button), `event-shared`, `event-link-opened` (someone opened a shared session link) and `added-to-calendar`. Visits from `localhost` aren't counted.

## How it gets the data

Each rink in [src/rinks.js](src/rinks.js) lists zero or more **sources**:

| type       | How it works | Examples |
|------------|--------------|----------|
| `ics`      | Reads a public iCalendar feed (Google Calendar, published Outlook calendar). Recurring events are expanded. | Penobscot Ice Arena, Talbot Rink, Cranston Veterans Memorial, Maple Grove |
| `finnly`   | Reads the JSON schedule embedded in a Finnly Connect page (`<rink>.finnlyconnect.com/schedule/<n>`) | Warrior Ice Arena, Everett Arena, Super Rink, ISCC |
| `daysmart` | Reads DaySmart Recreation ("Dash") events from the public API the rink's booking page uses. `company` is the slug in the rink's `apps.daysmartrecreation.com/dash/x/#/online/<slug>` links. `resourceIds` keeps only the ice sheets (list them at `api.dashplatform.com/v1/resources?company=<slug>`), which also splits a company that runs several arenas. | Campion Rink, Stamford Twin Rinks |
| `courtreserve` | Reads a CourtReserve public calendar (`/Online/Public/EmbedCode/<org>/<id>`) over the SignalR connection the calendar page itself uses. `categories` is a pattern for the event categories to include, since multi-sport clubs share one calendar. | Midcoast Recreation Center |
| `torontoDropIn` | City of Toronto drop-in skating from its open data (the "Drop-in" table of [Registered Programs and Drop In Courses](https://open.toronto.ca/dataset/registered-programs-and-drop-in-courses-offering/)), refreshed weekly about six weeks ahead. `locationId` is the arena's Location ID. | 40 Toronto arenas |
| `montrealArena` | Reads a City of Montréal arena page (`montreal.ca/lieux/arena-…`): weekly tables of patinage libre, hockey libre, bâton-rondelle and patinage artistique, repeated through each dated period. | 34 Montréal arenas |
| `classList` | Calgary's drop-in booking pages (`liveandplay.calgary.ca/REGPROG`), one page per category per day. `venue` picks the arena; the pages are shared between arenas during a build. | 11 Calgary arenas |
| `activenet` | An ActiveNet drop-in calendar (`anc.ca.apm.activecommunities.com/<site>/calendars` in Canada, `anc.apm.activecommunities.com/<site>/calendars` in the US). `calendarId` is the page's `defaultCalendarId`; `centerId` picks the rink; list them with `POST <site>/rest/onlinecalendar/filters` and `{"calendar_id": N}`. | 8 Vancouver rinks, Carolina Ice Palace |
| `pageText` | Reads times from text on the rink's web page ("Monday, September 21st ... 5:20 - 6:20 PM"). With `projectWeekly: N`, lines like "Sundays 3:50 - 4:50 PM" are repeated for N weeks. | Norway Savings Bank Arena |
| none       | Shown as a "check directly" card with the website and phone number | PDFs, Facebook, and booking widgets that can't be read |

Rentals and lessons never show the renter's name: Finnly and DaySmart rentals appear as their type ("Rental"), not the account.

The server caches each source for 30 minutes (in memory and in `data/cache.json`). The **Refresh** button forces a fresh pull. If a source fails, the app keeps showing its last good copy and flags the error.

Sessions are sorted into categories by keywords in their titles ([src/categorize.js](src/categorize.js)). Every session type shows by default, including "Team / private ice" (practices, games, rentals, lessons, closures). The **Filter** button opens a pop-up to pick only some types; once filtered, the sidebar shows a badge for each chosen type and each session shows its type label. Cancelled sessions are always hidden.

## States and provinces

`STATES` in [src/rinks.js](src/rinks.js) lists the US states and Canadian provinces (`country: 'CA'`) in the header's picker, and every rink has a `state` code. A state's `slug` is its address: `calarink.com/maine`, or `?state=maine`. Picking a state updates the address bar; a visitor with no state in the address gets the state they used last, else the one marked `default` (Maine).

Each state has a `tz`. Schedules that give local times with no zone (Finnly, page text) are read in it, and the site shows that state's times in it (Colorado is `America/Denver`, Newfoundland `America/St_Johns`, and so on). A rink in a different zone from the rest of its state sets its own `tz` (Dyer, Indiana is `America/Chicago`); its times are read in that zone and shown with the zone marked ("6:00 – 7:30 PM CT").

Session titles are sorted in English and French (patinage libre, hockey libre, bâton-rondelle) for Québec rinks.

To add a state, add it to `STATES` (for example `{ code: 'VT', slug: 'vermont', name: 'Vermont', tz: 'America/New_York' }`) and give its rinks that `state` code. The build creates its page automatically.

## Adding a rink

1. Find how the rink publishes its schedule. In the page source (and its schedule pages), look for `calendar.google.com/calendar/embed?src=...` (the ID goes into `gcal('...')`; embed IDs are sometimes base64), `finnlyconnect.com/schedule/<n>`, or `daysmartrecreation.com/dash/x/#/online/<slug>`, or a CourtReserve `/Online/Public/EmbedCode/<org>/<id>` calendar.
2. Add an entry to `RINKS` in `src/rinks.js`, with its `state` and `region`.
3. Restart the server locally, or push to `main` to publish.

A new schedule platform (for example EZFacility or Crossbar) needs a small adapter in `src/sources/`, registered in `ADAPTERS` in `src/schedule.js`.
