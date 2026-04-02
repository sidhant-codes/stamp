const { CohereClientV2 } = require('cohere-ai');
const { COHERE_API_KEY, COHERE_MODEL } = require('../config/env');

const cohere = new CohereClientV2({ token: COHERE_API_KEY });

// Cohere SDK: per-request timeout, and automatic retries with backoff on 429/5xx/timeouts.
const REQUEST_OPTIONS = { timeoutInSeconds: 45, maxRetries: 2 };

async function ask(prompt, { json = false, maxTokens = 1500, temperature = 0.3 } = {}) {
  const res = await cohere.chat(
    {
      model: COHERE_MODEL,
      messages: [{ role: 'user', content: prompt }],
      maxTokens,
      temperature,
      ...(json && { responseFormat: { type: 'json_object' } }),
    },
    REQUEST_OPTIONS
  );
  return res.message.content.map((c) => c.text || '').join('').trim();
}

// Tolerates code fences / chatter around the JSON object; returns null when nothing parses.
function parseJson(raw) {
  for (const candidate of [raw, raw.match(/\{[\s\S]*\}/)?.[0]]) {
    try {
      const v = JSON.parse(candidate);
      if (v && typeof v === 'object') return v;
    } catch {}
  }
  return null;
}

const list = (v) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : []);

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Whole-term, case-insensitive match on lowercased text: "Java" is not in "JavaScript", "Go" not in "good", "5" not in "2015".
const word = (term, flags) => new RegExp(`(?<![A-Za-z0-9])${escape(term)}(?![A-Za-z0-9])`, flags);
const has = (text, term) => word(term.toLowerCase()).test(text);
// A line is grounded when every number and tech term in it appears in the source text.
const grounded = (known, line) => [...numbers(line), ...terms(line)].every((t) => has(known, t));

// Capitalised words the job description uses mid-sentence ("experience with Kubernetes and Terraform"):
// mostly tools, skills and names. Sentence-initial words are skipped since they are capitalised anyway.
// ponytail: misses a skill that starts a line or sentence; Improve also bans the analysis's missing keywords.
function jobTerms(jobDesc) {
  const out = new Set();
  for (const line of jobDesc.split('\n')) {
    let prev = '';
    for (const tok of line.split(/\s+/)) {
      const core = tok.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9+#]+$/g, '');
      if (!core) continue; // bullets and dashes don't start or continue a sentence
      if (prev && !/[.!?]$/.test(prev) && /^[A-Z]/.test(core) && core.length > 1) out.add(core);
      prev = tok;
    }
  }
  return [...out];
}

// Patterns for job-description terms the candidate never mentioned; an output line using one is invented.
// Job terms match case-sensitively ("Go" the language, not "go"); `keywords` (analysis keywords) match any case.
const banned = (jobDesc, known, keywords = []) => [
  ...jobTerms(jobDesc).filter((t) => !has(known, t)).map((t) => word(t)),
  ...keywords.filter((k) => !has(known, k)).map((k) => word(k, 'i')),
];

exports.analyzeResume = async (resumeText, jobDesc) => {
  const resume = resumeText.slice(0, 12000);
  const prompt = `You are an expert resume screening assistant. Compare the resume with the job description.
Respond with JSON only:
{"score": <integer 0-100>, "feedback": "<2-3 sentence summary>", "strengths": ["..."], "gaps": ["missing skills or experience"],
 "keywords_matched": ["skills/keywords from the job description that the resume shows"],
 "keywords_missing": ["important skills/keywords from the job description the resume lacks"],
 "suggestions": [{"gap": "<one of the gaps>", "tip": "<one sentence of advice>", "rewrite": "<improved resume bullet>"}]}

Rules for suggestions:
- "rewrite" may only reword experience that is ALREADY in the resume so it speaks to the job. Never add skills, tools, numbers or achievements the resume does not contain.
- If the resume has no evidence for a gap, set "rewrite" to "" and make "tip" say to add it only if the candidate genuinely has it.
- At most 5 suggestions.

Resume:
${resume}

Job Description:
${jobDesc.slice(0, 6000)}`;

  let data = null;
  // Deterministic first try so the same inputs score the same; the retry needs some randomness.
  for (let attempt = 0; attempt < 2 && !data; attempt++) {
    data = parseJson(await ask(prompt, { json: true, maxTokens: 2000, temperature: attempt ? 0.3 : 0 }));
  }
  if (!data) throw Object.assign(new Error('The AI returned an unreadable answer, please try again'), { status: 502 });

  const lower = resume.toLowerCase();
  const jd = jobDesc.toLowerCase();
  const score = Math.max(0, Math.min(100, Math.round(Number(data.score)) || 0));
  // Keywords are checked in code so the lists can't contradict the actual texts.
  const matched = list(data.keywords_matched).filter((k) => has(lower, k));
  const missing = list(data.keywords_missing).filter((k) => has(jd, k) && !has(lower, k));
  const suggestions = (Array.isArray(data.suggestions) ? data.suggestions : [])
    .filter((x) => x && typeof x === 'object')
    .slice(0, 5)
    .map((x) => ({ gap: String(x.gap || ''), tip: String(x.tip || ''), rewrite: String(x.rewrite || '').trim() }))
    .filter((x) => x.gap || x.tip)
    // A rewrite is kept only if every number and tech term in it already appears in the resume.
    .map((x) => (x.rewrite && !grounded(lower, x.rewrite) ? { ...x, rewrite: '' } : x));
  return {
    score,
    feedback: String(data.feedback || ''),
    strengths: list(data.strengths),
    gaps: list(data.gaps),
    keywords_matched: matched,
    keywords_missing: missing,
    suggestions,
  };
};

// The model writes Summary/Experience/Projects/Education only. The header (name + contact)
// and Skills are built from the form in code, so they can never contain invented details.
const ORDER = ['summary', 'skills', 'experience', 'projects', 'education'];

const clean = (text) => {
  // The model sometimes wraps the resume in a code fence and adds commentary after it.
  const fenced = text.match(/^```(?:markdown)?\s*([\s\S]*?)(?:```|$)/i);
  return (fenced ? fenced[1] : text).split(/\n```/)[0].trim();
};

const numbers = (s) => s.match(/\d+(?:[.,]\d+)*/g) || [];
// Tech-looking terms: mixed case (MongoDB, TypeScript), dotted/slashed (Node.js, CI/CD) or ALL-CAPS (AWS).
const terms = (s) => s.match(/\b(?:[A-Za-z]*[a-z][A-Z][A-Za-z]*|[A-Za-z]+[.\/+#][A-Za-z]+|[A-Z]{2,})\b/g) || [];

function assemble(profile, body) {
  const sections = {};
  for (const part of body.split(/^##\s+/m).slice(1)) {
    const [title, ...rest] = part.split('\n');
    sections[title.trim().toLowerCase()] = rest.join('\n').trim();
  }
  const skills = String(profile.skills || '').split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
  sections.skills = skills.join(', ');
  // Drop sections the user left empty, even if the model wrote something anyway.
  for (const key of ['experience', 'projects', 'education']) {
    if (!String(profile[key] || '').trim()) delete sections[key];
  }
  const header = `# ${profile.name.trim()}${profile.contact?.trim() ? `\n${profile.contact.trim()}` : ''}`;
  const parts = ORDER.filter((k) => sections[k]).map((k) => `## ${k[0].toUpperCase() + k.slice(1)}\n${sections[k]}`);
  return [header, ...parts].join('\n\n');
}

exports.generateResume = async (profile, jobDesc) => {
  const facts = JSON.stringify(profile, null, 2);
  const prompt = `You are a professional resume writer. Write resume sections in Markdown from the candidate details below.

Write ONLY these sections, each starting with "## ": Summary, Experience, Projects, Education.
Do not write a name/contact header or a Skills section - those are added separately.

STRICT FACT RULES - the candidate details are the ONLY source of facts:
- Every employer, job title, date, degree, project, tool and responsibility must appear in the candidate details; otherwise leave it out.
- Never invent or infer numbers, percentages, years of experience, team sizes, achievements or technologies (do not add "Express.js" because "MERN" is mentioned).
- Only reword and organise what was given. Describe a project or role using only what the candidate said about it; do not add extra bullets about what they implemented, optimised or collaborated on.
- Summary: 1-2 sentences from provided facts only. No "experienced", "proven", "expertise" or "results-driven" unless supported. Give no job title or seniority that was not stated: a student with a project is a student, not an engineer.
- Omit a section entirely if the candidate gave no data for it. No placeholders.${
    jobDesc
      ? '\n- A target job description is given only to order and emphasise facts the candidate already provided. Never add anything from it.'
      : ''
  }
Output only the sections, no commentary.

Candidate details:
${facts}
${jobDesc ? `\nTarget job description:\n${jobDesc.slice(0, 6000)}` : ''}`;

  // Every number and tech term in the output must come from the candidate's own details.
  // Raw values, not the JSON, so escapes like "\n" don't glue onto the next word.
  const known = Object.values(profile).join('\n').toLowerCase();
  return assemble(profile, await writeGrounded(prompt, known, jobDesc ? banned(jobDesc, known) : []));
};

// Asks for Markdown with "## " sections whose numbers and tech terms all appear in `known` (lowercased source
// text) and whose lines use none of the `bans` patterns. Section headings ("## Experience") are exempt from bans.
async function writeGrounded(prompt, known, bans = []) {
  const ok = (l) => grounded(known, l) && (l.startsWith('## ') || !bans.some((re) => re.test(l)));
  for (let attempt = 0; attempt < 3; attempt++) {
    // Deterministic first try; retries need some randomness or they repeat the same output.
    const body = clean(await ask(prompt, { maxTokens: 1500, temperature: attempt ? 0.4 : 0 }));
    if (!/^##\s+\w/m.test(body)) continue;
    const lines = body.split('\n');
    if (lines.every(ok)) return body;
    if (attempt === 2) {
      // Last try: keep the grounded lines rather than failing outright.
      // ponytail: drops whole lines, so an invented date in a role heading also orphans its bullets.
      const kept = lines.filter(ok);
      if (kept.some((l) => l.trim() && !l.startsWith('#'))) return kept.join('\n');
    }
  }
  // billed: the model answered (and was paid for), so the controller must not refund this one.
  throw Object.assign(new Error('Could not generate a reliable resume from these details, please try again'), { status: 422, billed: true });
}

// How many of `keywords` appear (as whole terms) in `text`.
exports.keywordHits = (text, keywords) => keywords.filter((k) => has(text.toLowerCase(), k)).length;

// Rewrites an analysed resume for its job description. `confirmed` are missing keywords the user says they
// genuinely have; they are the only facts allowed beyond the resume itself.
exports.improveResume = async (resumeText, jobDesc, analysis, confirmed = []) => {
  const resume = resumeText.slice(0, 12000);
  const prompt = `You are a professional resume writer. Rewrite the resume below in Markdown so it scores higher against the job description.

Format: "# Full Name" on the first line, then one line of contact details exactly as in the resume, then sections that each start with "## " (for example Summary, Skills, Experience, Projects, Education, Certifications). Use "- " bullets.

How to improve it:
- Put the most relevant experience, projects and skills for this job first.
- Reword bullets to use the job description's terminology where the resume already shows that experience, and start them with strong action verbs.
- Apply the reviewer's suggestions below where the resume supports them.${
    confirmed.length ? `\n- The candidate confirms they also have: ${confirmed.join(', ')}. Add these to Skills, and nowhere else unless the resume already mentions them.` : ''
  }

STRICT FACT RULES - the resume${confirmed.length ? ' and the confirmed skills are' : ' is'} the ONLY source of facts:
- Never invent employers, titles, dates, degrees, numbers, percentages, team sizes, achievements or technologies.
- Never copy requirements from the job description into the resume as if the candidate had them.
- Keep every real employer, role, date and degree. Do not drop whole jobs or projects.
Output only the resume, no commentary.

Reviewer's gaps: ${(analysis.gaps || []).join('; ') || 'none'}
Reviewer's suggestions: ${(analysis.suggestions || []).map((x) => `${x.gap}: ${x.tip}`).join('; ') || 'none'}

Resume:
${resume}

Job description:
${jobDesc.slice(0, 6000)}`;

  const known = `${resume}\n${confirmed.join('\n')}`.toLowerCase();
  // Missing keywords the user did not confirm must not appear: adding them would be inventing skills.
  return writeGrounded(prompt, known, banned(jobDesc, known, analysis.keywords_missing || []));
};
