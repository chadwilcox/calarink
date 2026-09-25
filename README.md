# Maine Rink Times

Pulls public skate, stick & puck, shinny/pickup, and freestyle ice times from Maine rinks and shows them in one filterable list.

## Run it

Double-click `start.cmd`, or:

```
npm install
npm start
```

Then open http://localhost:5178. The server listens on `127.0.0.1` only. Set `HOST=0.0.0.0` to reach it from other devices on your network, or `PORT=xxxx` to change the port.

## Published site (GitHub Pages)

`.github/workflows/publish.yml` runs `npm run build` every 30 minutes, on every push to `main`, and on demand (Actions tab → Publish → Run workflow). The build pulls every rink once and writes `dist/`: the page plus `schedule.json`. The published page has no Refresh button; it re-reads `schedule.json` every 10 minutes.

- One-time setup: repo **Settings → Pages → Source: GitHub Actions**.
- A rink whose site fails keeps its last good copy (the workflow carries `data/` between runs). If every rink fails, the run stops and the old site stays up.
- GitHub can start scheduled runs late when it's busy, and pauses them after 60 days with no commits. Re-enable from the Actions tab.

## How it gets the data

Each rink in [src/rinks.js](src/rinks.js) lists zero or more **sources**:

| type       | How it works | Rinks |
|------------|--------------|-------|
| `ics`      | Reads a public iCalendar feed (Google Calendar, published Outlook calendar). Recurring events are expanded. | USM Ice Arena, UMaine Alfond Arena, Penobscot Ice Arena, The Forum (Presque Isle), Casco Bay Arena |
| `finnly`   | Reads the JSON schedule embedded in a Finnly Connect page | Thomas College Ice Vault, Piscataquis County Ice Arena |
| `pageText` | Reads times from text on the rink's web page ("Monday, September 21st ... 5:20 - 6:20 PM"). With `projectWeekly: N`, lines like "Sundays 3:50 - 4:50 PM" are repeated for N weeks. | Norway Savings Bank Arena |
| none       | Shown as a "check directly" card with the website and phone number | Troubh, Colisée, Sawyer, Midcoast Rec, Biddeford, Family Ice, Travis Roy, Thompson's Point |

The server caches each source for 30 minutes (in memory and in `data/cache.json`). The **Refresh** button forces a fresh pull. If a source fails, the app keeps showing its last good copy and flags the error.

Sessions are sorted into categories by keywords in their titles ([src/categorize.js](src/categorize.js)). Team practices, games, and rentals are hidden by default; tick "Also show team / private ice" to see the whole arena schedule.

## Adding a rink

1. Find how the rink publishes its schedule. Look in the page source for `calendar.google.com/calendar/embed?src=...`. That ID goes into `gcal('...')`.
2. Add an entry to `RINKS` in `src/rinks.js`.
3. Restart the server.

A new schedule platform (for example DaySmart/Dash or CourtReserve) needs a small adapter in `src/sources/`, registered in `ADAPTERS` in `src/schedule.js`.
