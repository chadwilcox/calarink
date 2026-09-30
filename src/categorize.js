// Sort a session title into a category. Order matters: first match wins.
// "public: true" categories are the ones anyone can walk in and pay for. French terms cover
// Québec rinks: patinage libre, hockey libre, bâton-rondelle, patinage artistique, fermé.
export const CATEGORIES = [
  { id: 'closed',     label: 'Closed / maintenance', public: false, re: /\b(closed|ice maintenance|no ice|hold)\b|\bferm[ée]/i },
  { id: 'stick-puck', label: 'Stick & Puck',         public: true,  re: /sticks?\s*(&|and|n'?|\+|,)?\s*pucks?|stick\s*(time|practice)|open\s*stick|b[âa]ton[\s-]*rondelle/i },
  { id: 'public',     label: 'Public Skate',         public: true,  re: /public\s*(ice\s*)?skat|open\s*skat|family\s*skate|community\s*skate|sponsored\s*skate|adult\s*skate\b|rock'?\s*n'?\s*skate|skate\s*with|public\s*session|leisure\s*skat|discount\s*(public\s*)?skate|and\s*better\s*skate|senior\s*skate|patin(age)?\s*libre/i },
  { id: 'shinny',     label: 'Shinny / Pickup',      public: true,  re: /shinny|pick[\s-]?up|drop[\s-]?in|open\s*hockey|public\s*hockey|rat\s*hockey|family\s*(fun\s*)?hockey|hockey\s*libre/i },
  { id: 'freestyle',  label: 'Freestyle',            public: true,  re: /freestyle|free\s*style|figure\s*open|open\s*figure|figure\s*skating\s*open|public\s*figure|patinage\s*artistique/i },
  { id: 'lts',        label: 'Learn to Skate',       public: false, re: /learn\s*to\s*(skate|play)|\blts\b/i },
];

export const OTHER = { id: 'other', label: 'Team / private ice', public: false };

export function categorize(text) {
  if (/student\s*(open|public)?\s*skate|members?\s*only/i.test(text)) return OTHER.id; // not open to the public
  for (const c of CATEGORIES) if (c.re.test(text)) return c.id;
  return OTHER.id;
}

export function isCancelled(text) {
  return /cancel+ed|cancel+ation|\bcancel\b|annul[ée]/i.test(text);
}

export const CATEGORY_LIST = [...CATEGORIES, OTHER].map(({ id, label, public: pub }) => ({ id, label, public: pub }));
