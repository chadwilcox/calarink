// Maine rink registry.
//
// source.type:
//   'ics'      – iCalendar feed (public Google Calendars work: .../calendar/ical/<id>/public/basic.ics)
//   'finnly'   – Finnly Connect public schedule page
//   'pageText' – schedule posted as text on a web page (dated lines, optional weekly lines)
//   none       – no machine-readable schedule; shown as a "check directly" card
//
// To add a rink, append an entry. `id` must be unique and stable (it's used in the URL filters).

const gcal = id => `https://calendar.google.com/calendar/ical/${encodeURIComponent(id)}/public/basic.ics`;

export const RINKS = [
  {
    id: 'usm-gorham',
    name: 'USM Ice Arena',
    town: 'Gorham', region: 'Southern',
    website: 'https://usm.maine.edu/ice-arena/hours/',
    sources: [{ type: 'ics', url: gcal('usmicearena@maine.edu') }],
    note: 'Full arena calendar. "Student Open Skate" is USM-only.',
  },
  {
    id: 'ice-vault-hallowell',
    name: 'Thomas College Ice Vault',
    town: 'Hallowell', region: 'Central',
    address: '203 Whitten Rd, Hallowell, ME',
    website: 'https://www.maineicevault.com/',
    scheduleUrl: 'https://tciv.finnlyconnect.com/schedule/612',
    sources: [{ type: 'finnly', url: 'https://tciv.finnlyconnect.com/schedule/612' }],
    note: 'Public skate $10, rentals $6. Weekend sessions often sell out — buy online.',
  },
  {
    id: 'alfond-orono',
    name: 'Alfond Arena (UMaine)',
    town: 'Orono', region: 'Northern & Downeast',
    website: 'https://umaine.edu/campusrecreation/facilities__trashed/alfond-arena/',
    sources: [{ type: 'ics', url: gcal('o84kduv0jjtn8siju6nu5i9ueg@group.calendar.google.com') }],
    note: 'Public skate & stick-and-puck calendar only (Campus Rec). Stick & Puck is 18+.',
  },
  {
    id: 'pia-brewer',
    name: 'Penobscot Ice Arena (PIA)',
    town: 'Brewer', region: 'Northern & Downeast',
    address: '90 Acme Rd, Brewer, ME', phone: '207-989-7183',
    website: 'https://www.penobscoticearena.com/',
    sources: [{ type: 'ics', url: gcal('m3mm3gbf0u02ko5jcg9r7c091k@group.calendar.google.com') }],
    note: 'Full arena calendar. Some stick n puck sessions are age-split (13 & under / 14 & over).',
  },
  {
    id: 'pcia-dover-foxcroft',
    name: 'Piscataquis County Ice Arena (PCIA)',
    town: 'Dover-Foxcroft', region: 'Northern & Downeast',
    address: '1049 W Main St, Dover-Foxcroft, ME',
    website: 'https://www.thepcia.com/public-skate.html',
    scheduleUrl: 'https://pcia.finnlyconnect.com/schedule/903',
    sources: [{ type: 'finnly', url: 'https://pcia.finnlyconnect.com/schedule/903' }],
    note: 'Public skate $10, walk-ins welcome; skate rental $3. "Stick Time" is their stick & puck.',
  },
  {
    id: 'forum-presque-isle',
    name: 'The Forum',
    town: 'Presque Isle', region: 'Northern & Downeast',
    phone: '207-764-0491',
    website: 'https://www.thepiforum.org/',
    sources: [{ type: 'ics', url: 'https://outlook.office365.com/owa/calendar/0069475393ca4306b04019da8c33ab28@presqueisleme.us/815093ea02cb4d868f4e76c2f0ebcc8c8151721194698282749/calendar.ics' }],
    note: 'Full arena calendar (City of Presque Isle Outlook calendar). Public skate $7, rentals $5. Times can change for hockey games — call to confirm.',
  },
  {
    id: 'casco-bay-falmouth',
    name: 'Casco Bay Arena',
    town: 'Falmouth', region: 'Southern',
    website: 'https://cascobayarena.com/ice-schedule-2/',
    sources: [{ type: 'ics', url: gcal('12qbntcc8t3cgl39lde3pm54ao@group.calendar.google.com') }],
    note: 'Arena master schedule. Mostly team ice; "OPEN" = unbooked ice, not a public session.',
  },
  {
    id: 'nsb-auburn',
    name: 'Norway Savings Bank Arena',
    town: 'Auburn', region: 'Central',
    address: '985 Turner St, Auburn, ME',
    website: 'https://www.norwaysavingsbankarena.com/page/show/8447987-drop-in-recreational-programming',
    sources: [
      { type: 'pageText', title: 'Public Skate', url: 'https://www.norwaysavingsbankarena.com/page/show/7694782-public-skate-', projectWeekly: 6 },
      { type: 'pageText', title: 'Shinny Hockey', url: 'https://www.norwaysavingsbankarena.com/page/show/8023693-shinny-hockey-schedule-' },
    ],
    note: 'Read from the arena\'s posted text. Public skate $5; shinny $10. Changes often — check the site.',
  },

  // ---- No machine-readable schedule: shown as "check directly" ----
  {
    id: 'troubh-portland',
    name: 'Troubh Ice Arena',
    town: 'Portland', region: 'Southern',
    address: '225 Park Ave, Portland, ME', phone: '207-774-8553',
    website: 'https://www.portlandmaine.gov/528/William-B-Troubh-Ice-Arena',
    note: 'Public skate calendar is posted as a monthly PDF.',
  },
  {
    id: 'colisee-lewiston',
    name: 'The Colisée',
    town: 'Lewiston', region: 'Central',
    address: '190 Birch St, Lewiston, ME', phone: '207-783-2009',
    website: 'https://www.thecolisee.com/',
  },
  {
    id: 'sawyer-bangor',
    name: 'Sawyer Arena',
    town: 'Bangor', region: 'Northern & Downeast',
    address: '107 13th St, Bangor, ME', phone: '207-947-0071',
    website: 'https://www.bangormaine.gov/676/Sawyer-Arena',
    note: 'Closed for the off-season; reopens October 2026. Public skate times are posted as PDFs on Bangor Parks & Rec (bangorme.myrec.com) and Facebook.',
  },
  {
    id: 'midcoast-rockport',
    name: 'Midcoast Recreation Center',
    town: 'Rockport', region: 'Midcoast',
    address: '535 West St, Rockport, ME', phone: '207-236-9400',
    website: 'https://www.midcoastrec.org/public-skate',
    scheduleUrl: 'https://book.midcoastrec.org/Online/Public/EmbedCode/16147/58434?customId=125636',
    note: 'Arena schedule is a live CourtReserve calendar (not scrapeable without a browser).',
  },
  {
    id: 'biddeford',
    name: 'Biddeford Ice Arena',
    town: 'Biddeford', region: 'Southern',
    address: '14 Pomerleau St, Biddeford, ME', phone: '207-283-0615',
    website: 'https://biddefordarena.com/public-skating',
    note: 'Public skating is limited; they post times on Facebook.',
  },
  {
    id: 'family-ice-falmouth',
    name: 'Family Ice Center',
    town: 'Falmouth', region: 'Southern',
    address: '20 Hat Trick Dr, Falmouth, ME', phone: '207-781-4200',
    website: 'https://familyice.org/programs/public-skating/',
    note: 'Outdoor pond only, early Dec – late Feb, 10am–9pm daily, weather permitting. Free. No indoor public skate.',
  },
  {
    id: 'travis-roy-yarmouth',
    name: 'Travis Roy Ice Arena (NYA)',
    town: 'Yarmouth', region: 'Southern',
    website: 'https://www.facebook.com/NYATravisRoyArena/',
  },
  {
    id: 'thompsons-point',
    name: "The Rink at Thompson's Point (outdoor, seasonal)",
    town: 'Portland', region: 'Southern',
    website: 'https://www.thompsonspointrink.com/iceschedule',
  },
];
