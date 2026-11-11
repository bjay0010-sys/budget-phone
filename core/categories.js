/* Categories, merchant clean-up and the rule engine.
   Groups decide how a transaction is counted:
     living   -> everyday spending (what the budget is measured on)
     income   -> money in
     transfer -> moves between your own accounts (ignored everywhere)
     bookie   -> bookmaker deposits/withdrawals (own net line, never "spending")
     ebay     -> eBay stock, fees, postage and sales (own net line)
     saving   -> savings / investing (counted as saving, not spending)  */
(function (g) {
  const BT = (g.BT = g.BT || {});

  const GROUPS = {
    living: 'Living spend', income: 'Income', transfer: 'Transfers', bookie: 'Bookmaker', ebay: 'eBay reselling', saving: 'Savings & investing',
  };

  // order = display order
  const CATS = [
    { id: 'groceries', name: 'Groceries', group: 'living' },
    { id: 'eating', name: 'Eating out', group: 'living' },
    { id: 'coffee', name: 'Coffee & snacks', group: 'living' },
    { id: 'transport', name: 'Transport', group: 'living' },
    { id: 'fuel', name: 'Fuel & car', group: 'living' },
    { id: 'shopping', name: 'Shopping', group: 'living' },
    { id: 'fun', name: 'Fun & social', group: 'living' },
    { id: 'subs', name: 'Subscriptions', group: 'living' },
    { id: 'health', name: 'Health', group: 'living' },
    { id: 'gym', name: 'Gym & fitness', group: 'living' },
    { id: 'uni', name: 'Uni & study', group: 'living' },
    { id: 'bills', name: 'Bills & phone', group: 'living' },
    { id: 'rent', name: 'Rent & housing', group: 'living' },
    { id: 'personal', name: 'Personal care', group: 'living' },
    { id: 'gifts', name: 'Gifts & donations', group: 'living' },
    { id: 'fees', name: 'Bank fees', group: 'living' },
    { id: 'other', name: 'Other', group: 'living' },
    { id: 'uncat', name: 'Needs a category', group: 'living' },
    { id: 'pay', name: 'Pay', group: 'income' },
    { id: 'income_other', name: 'Other income', group: 'income' },
    { id: 'transfer', name: 'Own-account transfer', group: 'transfer' },
    { id: 'bookie', name: 'Bookmaker', group: 'bookie' },
    { id: 'ebay', name: 'eBay reselling', group: 'ebay' },
    { id: 'saving', name: 'Savings & investing', group: 'saving' },
  ];
  const BYID = Object.fromEntries(CATS.map((c) => [c.id, c]));

  // Default rules. First match wins, so specific rules come before general ones.
  // A pattern wrapped in /slashes/ is a regex; anything else is a plain case-insensitive "contains".
  const DEFAULT_RULES = [
    // --- things that must win over generic words ---
    ['/internal transfer|transfer (to|from) (my |own |your )?(save|spend|savings|spending|ubank)|(to|from) (my )?(save|spend|savings) account|ubank (save|spend)|round ?up/', 'transfer'],
    ['uber eats', 'eating'], ['ubereats', 'eating'], ['doordash', 'eating'], ['menulog', 'eating'], ['deliveroo', 'eating'],
    // --- bookmakers ---
    ['/\\b(sportsbet|bet ?365|ladbrokes|neds|pointsbet|unibet|betfair|palmerbet|bluebet|dabble|betr|topsport|boombet|betright|draftstars|playup|tabtouch|tab)\\b/', 'bookie'],
    // --- eBay reselling (stock, fees, postage, sales) ---
    ['/\\bebay\\b/', 'ebay'], ['/\\b(sendle|startrack|aramex|couriers please|australia post|auspost|aus post)\\b/', 'ebay'],
    // --- income ---
    ['physioworks', 'pay'], ['/\\b(salary|payroll|wages?)\\b/', 'pay'],
    ['/\\b(interest (paid|earned|credit)|cashback|centrelink|ato refund|tax refund|reimburse)/', 'income_other'],
    // --- savings / investing ---
    ['/\\b(commsec|stake|raiz|spaceship|betashares|pearler|selfwealth|swyftx|coinspot|vanguard|ishares)\\b/', 'saving'],
    // --- groceries ---
    ['/\\b(coles|woolworths|woolies|aldi|iga|harris farm|costco|foodworks|spar)\\b/', 'groceries'], ['/asian (grocer|mart|supermarket)|supermarket|fruit (&|and) veg|butcher|fresh (food|market)/', 'groceries'],
    // --- eating out ---
    ['/mcdonald|\\bkfc\\b|hungry jack|subway|domino|pizza|nando|guzman|grill.?d|zambrero|oporto|red rooster|sushi|thai\\b|noodle|restaurant|kebab|burger|dumpling|ramen|pho\\b|bakery|chicken|takeaway|dim sum|hot pot|\\bbbq\\b|kitchen|eatery|diner|\\bbar & grill|food court/', 'eating'],
    // --- coffee & snacks ---
    ['/coffee|cafe|café|starbucks|gloria jean|boost juice|chatime|gong cha|bubble|\\btea\\b|\\bzeus\\b|donut|gelato|ice ?cream|juice|bake ?house|7-?eleven|convenience/', 'coffee'],
    // --- transport ---
    ['/\\b(myki|ptv|public transport|opal)\\b|uber (trip|\\*trip|bv|help)|\\buber\\b|didi|13cabs|\\bola\\b|linkt|citylink|eastlink|parking|ezypark|wilson park|secure park|lime\\b|neuron/', 'transport'],
    // --- fuel & car ---
    ['/\\b(shell|bp|caltex|ampol|united petroleum|puma|reddy express|coles express|liberty)\\b|racv|vicroads|service vic|rego|repco|supercheap|autobarn|car wash/', 'fuel'],
    // --- subscriptions ---
    ['/spotify|netflix|disney|youtube ?(premium|music)?|apple\\.com|itunes|google (one|storage|\\*)|chatgpt|openai|anthropic|claude\\.ai|adobe|microsoft ?(365|\\*)|amazon prime|prime video|paramount|\\bstan\\b|binge|kayo|audible|patreon|dropbox|icloud|canva|notion|github|steam|playstation|nintendo|xbox/', 'subs'],
    // --- health / gym ---
    ['/pharmacy|chemist|priceline|medibank|bupa|\\bhcf\\b|\\bnib\\b|doctor|medical|dental|dentist|physio|terry white|optometr|specsavers|pathology|clinic|hospital/', 'health'],
    ['/\\bgym\\b|anytime fitness|\\bf45\\b|fitness first|snap fitness|plus fitness|jetts|goodlife|crunch|city fitness|fitness|protein|supplement|bulk nutrients|muscle/', 'gym'],
    // --- uni ---
    ['/monash|student (services|union)|\\bmsa\\b|co-?op bookshop|nexus|turnitin|lexisnexis|westlaw|cambridge univ|oxford univ|textbook|uni ?books/', 'uni'],
    // --- bills ---
    ['/telstra|optus|vodafone|boost mobile|amaysim|belong|aussie broadband|\\borigin\\b|\\bagl\\b|energy ?australia|red energy|water|council|insurance|allianz|youi|\\baami\\b|nrma|medicare/', 'bills'],
    ['/\\brent\\b|real estate|ray white|raine ?(&|and) horne|belle property|bond|landlord/', 'rent'],
    // --- shopping ---
    ['/amazon|kmart|target|big ?w|jb ?hi-?fi|officeworks|uniqlo|h ?& ?m\\b|cotton on|bunnings|the iconic|asos|shein|temu|aliexpress|kogan|catch\\.com|harvey norman|rebel sport|nike|adidas|myer|david jones|ikea|jd sports|bing lee|the good guys/', 'shopping'],
    // --- fun ---
    ['/cinema|hoyts|event cinemas|village cinemas|ticketek|ticketmaster|eventbrite|bowling|timezone|dan murphy|\\bbws\\b|liquorland|\\bpub\\b|tavern|brewery|nightclub|\\bclub\\b|uni bar|karaoke|escape room|laser|arcade|concert|festival|ball\\b/', 'fun'],
    // --- personal / gifts / fees ---
    ['/barber|hair|salon|beauty|sephora|mecca|nails|waxing|lashes/', 'personal'],
    ['/\\bgift|donation|red cross|unicef|oxfam|gofundme|charity|world vision|\\bzakat|\\bsadaqah|islamic relief/', 'gifts'],
    ['/\\bfee\\b|interest charged|overseas transaction|\\batm\\b|international transaction|dishonour/', 'fees'],
  ];

  const NOISE = /\b(com|www|visa|mastercard|eftpos|debit|credit|purchase|card|contactless|apple pay|google pay|pos|aus|au|australia|vic|nsw|qld|wa|sa|tas|act|nt|melbourne|clayton|officer|burwood|mount waverley|chadstone|box hill|pty|ltd|p\/l|value date|ref|receipt|payment|transaction|tap|sq|tst|zlr|sp|pp|paypal)\b/gi;

  /** Strip bank noise so "VISA PURCHASE 11NOV COLES 0412 CLAYTON VIC" ~ "coles". Used for rules + dedupe + duplicates. */
  function merchantKey(desc) {
    let s = String(desc || '').toLowerCase();
    s = s.replace(/[*#]/g, ' ').replace(/\b\d{1,2}[\/\-]\d{1,2}([\/\-]\d{2,4})?\b/g, ' ').replace(/\b\d{1,2}\s?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/g, ' ');
    s = s.replace(NOISE, ' ').replace(/[^a-z0-9&' ]+/g, ' ').replace(/\b\d{3,}\b/g, ' ').replace(/\b[a-z]?\d+[a-z]?\b/g, ' ').replace(/\b(?=[a-z0-9]*\d)(?=[a-z0-9]*[a-z])[a-z0-9]{4,}\b/g, ' ');
    const t = s.split(/\s+/).filter(Boolean);
    return t.slice(0, 3).join(' ');
  }

  const PRETTY = [[/\bMcdonalds\b/, "McDonald's"], [/\bJb Hi Fi\b/, 'JB Hi-Fi'], [/\bPtv Myki( Top)?( Up)?\b/, 'Myki'], [/\bPtv\b/, 'PTV'], [/\bKfc\b/, 'KFC'], [/\bBws\b/, 'BWS'], [/\bIga\b/, 'IGA'], [/\bBp\b/, 'BP'], [/\bAmazon Au Marketplace\b/, 'Amazon'], [/\bDan Murphys\b/, "Dan Murphy's"], [/\bNandos\b/, "Nando's"], [/\bGuzman Y Gomez\b/, 'Guzman y Gomez'], [/\bUber Eats\b.*/, 'Uber Eats'], [/\bEbay\b/, 'eBay'], [/^Eleven$/, '7-Eleven'], [/^Amazon Marketplace$/, 'Amazon']];
  /** Nicer display name for a merchant. */
  function prettyName(desc) {
    const k = merchantKey(desc);
    const base = k || String(desc || '').trim().toLowerCase();
    let out = base.replace(/\b[a-z]/g, (c) => c.toUpperCase());
    for (const [re, to] of PRETTY) out = out.replace(re, to);
    return out;
  }

  function compile(p) {
    if (p.length > 2 && p[0] === '/' && p[p.length - 1] === '/') {
      try { const re = new RegExp(p.slice(1, -1), 'i'); return (s) => re.test(s); } catch (e) { return () => false; }
    }
    const q = p.toLowerCase();
    return (s) => s.includes(q);
  }
  const compiled = new Map();
  function test(p, s) { let f = compiled.get(p); if (!f) { f = compile(p); compiled.set(p, f); } return f(s); }

  const CREDIT_WORDS = /\b(salary|payroll|wages?|deposit|refund|interest|received|cashback|reversal|transfer from|credit|osko from|payid from)\b/i;

  /**
   * Decide a category. userRules = [{pattern, category}], checked first (newest first).
   * Returns {category, source: 'user'|'rule'|'guess'|'none'}.
   */
  function categorise(desc, amountCents, userRules) {
    const text = String(desc || '').toLowerCase();
    if (userRules) for (const r of userRules) { if (r.pattern && test(r.pattern, text)) return { category: r.category, source: 'user' }; }
    for (const [p, cat] of DEFAULT_RULES) { if (test(p, text)) return { category: cat, source: 'rule' }; }
    if (amountCents > 0) return { category: 'income_other', source: 'guess' };
    return { category: 'uncat', source: 'none' };
  }

  BT.cats = { GROUPS, CATS, BYID, DEFAULT_RULES, merchantKey, prettyName, categorise, CREDIT_WORDS,
    group: (id) => (BYID[id] ? BYID[id].group : 'living'),
    name: (id) => (BYID[id] ? BYID[id].name : id) };
  if (typeof module !== 'undefined' && module.exports) module.exports = BT.cats;
})(typeof window !== 'undefined' ? window : globalThis);
