// Sort a session title into a category. Order matters: first match wins.
// "public: true" categories are the ones anyone can walk in and pay for.
export const CATEGORIES = [
  { id: 'closed',     label: 'Closed / maintenance', public: false, re: /\b(closed|ice maintenance|no ice|hold)\b/i },
  { id: 'stick-puck', label: 'Stick & Puck',         public: true,  re: /stick\s*(&|and|n'?|\+)?\s*puck|stick\s*(time|practice)|open\s*stick/i },
  { id: 'public',     label: 'Public Skate',         public: true,  re: /public\s*skat|open\s*skat|family\s*skate|community\s*skate|sponsored\s*skate|adult\s*skate\b|rock'?\s*n'?\s*skate|skate\s*with|public\s*session/i },
  { id: 'shinny',     label: 'Shinny / Pickup',      public: true,  re: /shinny|pick[\s-]?up|drop[\s-]?in|open\s*hockey|public\s*hockey|rat\s*hockey/i },
  { id: 'freestyle',  label: 'Freestyle',            public: true,  re: /freestyle|free\s*style|figure\s*open|open\s*figure/i },
  { id: 'lts',        label: 'Learn to Skate',       public: false, re: /learn\s*to\s*(skate|play)|\blts\b/i },
];

export const OTHER = { id: 'other', label: 'Team / private ice', public: false };

export function categorize(text) {
  if (/student\s*(open|public)?\s*skate|members?\s*only/i.test(text)) return OTHER.id; // not open to the public
  for (const c of CATEGORIES) if (c.re.test(text)) return c.id;
  return OTHER.id;
}

export function isCancelled(text) {
  return /cancel+ed|cancel+ation|\bcancel\b/i.test(text);
}

export const CATEGORY_LIST = [...CATEGORIES, OTHER].map(({ id, label, public: pub }) => ({ id, label, public: pub }));
