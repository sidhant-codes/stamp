const { test } = require('node:test');
const assert = require('node:assert');
const { check } = require('../src/services/ats');

const failed = (text) => check(text).filter((c) => !c.pass).map((c) => c.label);

test('a well-formed resume passes every ATS check', () => {
  const resume = `Jane Doe
jane@example.com | +91 98765 43210
EXPERIENCE
Backend Intern, Acme (Jun 2024 - Aug 2024)
• Built REST APIs serving 2,000 users
• Designed MongoDB schemas for 3 services
• Reduced build time by 40%
EDUCATION
B.Tech CSE (2021 - 2025)
SKILLS
Node.js, React
${'word '.repeat(260)}`;
  assert.deepEqual(failed(resume), []);
});

test('each problem is reported, and year ranges are not mistaken for a phone number', () => {
  const resume = 'I am a developer. My skills are good.\nProjects\n- worked on stuff\nDates: 01/2024 and Jan 2023\n2019 - 2021 2021 - 2023';
  assert.deepEqual(failed(resume), [
    'Email address',
    'Phone number',
    'Standard section headings',
    'Length',
    'Bullets start with action verbs',
    'Achievements with numbers',
    'One date format',
    'No first-person pronouns',
  ]);
  assert.match(check(resume).find((c) => c.label === 'No first-person pronouns').detail, /^2 found/);
});

test('Markdown resumes (from Improve) are checked the same way', () => {
  const md = `# Jane\njane@example.com, +1 415 555 0100\n\n## Experience\n- Led a team of 4\n- Shipped 2 apps\n- Automated 10 reports\n\n## Education\nBSc\n\n## Skills\nGo\n${'word '.repeat(260)}`;
  assert.deepEqual(failed(md), []);
});
