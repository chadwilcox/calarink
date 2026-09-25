# Calarink

<img src="public/logo.svg" width="64" alt="Calarink logo">

Pulls public skate, stick & puck, shinny/pickup, and freestyle ice times from ice rinks and shows them in one filterable list. Live at **https://calarink.com**, one page per state: `/connecticut`, `/maine`, `/massachusetts`, `/minnesota`, `/new-hampshire`, `/rhode-island`.

## Run it

Double-click `start.cmd`, or:

```
npm install
npm start
```

Then open http://localhost:5178. The server listens on `127.0.0.1` only. Set `HOST=0.0.0.0` to reach it from other devices on your network, or `PORT=xxxx` to change the port.

## Published site (calarink.com)

GitHub Pages serves the site at calarink.com; the domain is registered with Cloudflare, whose DNS points at GitHub (records set to DNS only). `.github/workflows/publish.yml` runs `npm run build` every 30 minutes, on every push to `main`, and on demand (Actions tab → Publish → Run workflow). The build pulls every rink once and writes `dist/`: the page, `schedule.json`, and a copy of the page for each state (`dist/maine/index.html`). The published page has no Refresh button; it re-reads `schedule.json` every 10 minutes.

- **Visitor's state (Cloudflare Worker):** calarink.com is proxied through Cloudflare (orange cloud; SSL mode must not be Flexible or GitHub's HTTPS redirect loops). The Worker in [worker/](worker/) adds `<meta name="visitor-region" content="ME">` to each page from Cloudflare's own location data, so a first-time visitor opens their state. A state in the address or the visitor's last pick still wins. Deploy changes with `npx wrangler deploy` from `worker/` (needs `npx wrangler login`).
- GitHub renews its HTTPS certificate for calarink.com through the Cloudflare proxy; the current one expires 2026-12-24. If the site ever shows a certificate error after that, check Settings → Pages in the repo.
- A rink whose site fails keeps its last good copy (the workflow carries `data/` between runs). If every rink fails, the run stops and the old site stays up.
- GitHub can start scheduled runs late when it's busy, and pauses them after 60 days with no commits. Re-enable from the Actions tab.

## How it gets the data

Each rink in [src/rinks.js](src/rinks.js) lists zero or more **sources**:

| type       | How it works | Examples |
|------------|--------------|----------|
| `ics`      | Reads a public iCalendar feed (Google Calendar, published Outlook calendar). Recurring events are expanded. | Penobscot Ice Arena, Talbot Rink, Cranston Veterans Memorial, Maple Grove |
| `finnly`   | Reads the JSON schedule embedded in a Finnly Connect page (`<rink>.finnlyconnect.com/schedule/<n>`) | Warrior Ice Arena, Everett Arena, Super Rink, ISCC |
| `daysmart` | Reads DaySmart Recreation ("Dash") events from the public API the rink's booking page uses. `company` is the slug in the rink's `apps.daysmartrecreation.com/dash/x/#/online/<slug>` links. | Campion Rink, Stamford Twin Rinks |
| `pageText` | Reads times from text on the rink's web page ("Monday, September 21st ... 5:20 - 6:20 PM"). With `projectWeekly: N`, lines like "Sundays 3:50 - 4:50 PM" are repeated for N weeks. | Norway Savings Bank Arena |
| none       | Shown as a "check directly" card with the website and phone number | PDFs, Facebook, and booking widgets that can't be read |

Rentals and lessons never show the renter's name: Finnly and DaySmart rentals appear as their type ("Rental"), not the account.

The server caches each source for 30 minutes (in memory and in `data/cache.json`). The **Refresh** button forces a fresh pull. If a source fails, the app keeps showing its last good copy and flags the error.

Sessions are sorted into categories by keywords in their titles ([src/categorize.js](src/categorize.js)). Team practices, games, rentals, lessons and closures fall under the "Team / private ice" type button, which is off by default; switch it on to see the whole arena schedule. Cancelled sessions are always hidden. Each session shows its type label only when some types are switched off.

## States

`STATES` in [src/rinks.js](src/rinks.js) lists the states in the header's state picker, and every rink has a `state` code. A state's `slug` is its address: `calarink.com/maine`, or `?state=maine`. Picking a state updates the address bar; a visitor with no state in the address gets the state they used last, else the one marked `default` (Maine).

Each state has a `tz`. Schedules that give local times with no zone (Finnly, page text) are read in it, and the site shows that state's times in it: Minnesota is `America/Chicago`, the rest Eastern.

To add a state, add it to `STATES` (for example `{ code: 'VT', slug: 'vermont', name: 'Vermont', tz: 'America/New_York' }`) and give its rinks that `state` code. The build creates its page automatically.

## Adding a rink

1. Find how the rink publishes its schedule. In the page source (and its schedule pages), look for `calendar.google.com/calendar/embed?src=...` (the ID goes into `gcal('...')`; embed IDs are sometimes base64), `finnlyconnect.com/schedule/<n>`, or `daysmartrecreation.com/dash/x/#/online/<slug>`.
2. Add an entry to `RINKS` in `src/rinks.js`, with its `state` and `region`.
3. Restart the server locally, or push to `main` to publish.

A new schedule platform (for example EZFacility, Crossbar or CourtReserve) needs a small adapter in `src/sources/`, registered in `ADAPTERS` in `src/schedule.js`.
