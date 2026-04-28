// Deterministic ATS / recruiter checks on resume text (PDF text or Markdown). No AI, so free and repeatable.

const VERBS = new Set(
  ('achieved analysed analyzed architected automated built collaborated conducted configured contributed created debugged ' +
    'delivered deployed designed developed drove engineered established evaluated handled implemented improved increased ' +
    'integrated launched led maintained managed mentored migrated modelled modeled monitored optimised optimized organised ' +
    'organized owned planned presented prototyped published reduced refactored researched resolved scaled shipped simplified ' +
    'solved streamlined supported tested trained wrote').split(' ')
);

const SECTIONS = {
  Experience: /^(work |professional |relevant )?(experience|employment|internships?)\b/i,
  Education: /^(education|academic)/i,
  Skills: /^(technical |key |core )?skills\b/i,
};

const BULLET = /^[•●▪◦‣■\-*–]\s*/;
const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';

// A run of digits/spaces/dashes with 10-15 digits that is not just years ("2019 - 2021 2021 - 2023").
const hasPhone = (text) =>
  (text.match(/\+?\d[\d\s().-]{8,}\d/g) || []).some((m) => {
    const digits = m.replace(/\D/g, '');
    return digits.length >= 10 && digits.length <= 15 && !/^((19|20)\d\d)+$/.test(digits);
  });

// -> [{ label, pass, detail }]
exports.check = (text) => {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const headings = lines.map((l) => l.replace(/^#+\s*/, '')).filter((l) => l.length <= 40);
  const missing = Object.keys(SECTIONS).filter((name) => !headings.some((h) => SECTIONS[name].test(h)));

  const bullets = lines.filter((l) => BULLET.test(l) && !/^-{2,}/.test(l)).map((l) => l.replace(BULLET, ''));
  const first = (b) => (b.match(/[A-Za-z]+/)?.[0] || '').toLowerCase();
  // ponytail: verb list + "-ed" heuristic; misses rarer verbs, a proper POS tagger if this matters.
  const strong = bullets.filter((b) => VERBS.has(first(b)) || /ed$/.test(first(b))).length;
  const quantified = bullets.filter((b) => /\d/.test(b)).length;

  const words = text.split(/\s+/).filter((w) => /[A-Za-z]/.test(w)).length;
  const dateStyles = [
    [new RegExp(`\\b${MONTH}\\s+\\d{4}\\b`, 'i'), 'Jan 2024'],
    [/\b(0?[1-9]|1[0-2])\/\d{4}\b/, '01/2024'],
  ]
    .filter(([re]) => re.test(text))
    .map(([, label]) => label);
  const pronouns = (text.match(/\b(?:I|[Mm]y|[Mm]e)\b(?![/&])/g) || []).length;
  const ofBullets = (n) => (bullets.length ? `${n} of ${bullets.length} bullets` : 'No bullet points found');

  return [
    { label: 'Email address', pass: /[\w.+-]+@[\w-]+\.[\w.]+/.test(text), detail: '' },
    { label: 'Phone number', pass: hasPhone(text), detail: '' },
    { label: 'Standard section headings', pass: !missing.length, detail: missing.length ? `Not found: ${missing.join(', ')}` : '' },
    { label: 'Length', pass: words >= 250 && words <= 1000, detail: `${words} words (aim for 250-1000)` },
    { label: 'Bullets start with action verbs', pass: bullets.length >= 3 && strong / bullets.length >= 0.6, detail: ofBullets(strong) },
    {
      label: 'Achievements with numbers',
      pass: bullets.length > 0 && quantified / bullets.length >= 0.3,
      detail: `${ofBullets(quantified)} (add real figures only)`,
    },
    { label: 'One date format', pass: dateStyles.length <= 1, detail: dateStyles.length > 1 ? `Mixed: ${dateStyles.join(' and ')}` : '' },
    { label: 'No first-person pronouns', pass: !pronouns, detail: pronouns ? `${pronouns} found ("I", "my", "me")` : '' },
  ];
};
