const fs = require("fs");
const path = require("path");
const file = path.join(__dirname, "test.json");
const data = JSON.parse(fs.readFileSync(file, "utf8"));
const errors = [];
const seen = new Set();
if (!Array.isArray(data)) throw new Error("test.json root must be an array");
if (data.length !== 5000) errors.push(`Expected 5000 questions, got ${data.length}`);
data.forEach((q, i) => {
  if (!q || typeof q.question !== "string" || !q.question.trim()) errors.push(`#${i+1}: missing question`);
  if (!Array.isArray(q.options) || q.options.length !== 4) errors.push(`#${i+1}: expected exactly 4 options`);
  else if (new Set(q.options.map(String)).size !== q.options.length) errors.push(`#${i+1}: duplicate options`);
  if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= (q.options || []).length) errors.push(`#${i+1}: invalid answer index`);
  if (q.options && q.options[q.answer] === undefined) errors.push(`#${i+1}: answer does not point to an option`);
  if (!q.category || !q.difficulty) errors.push(`#${i+1}: missing category/difficulty`);
  const key = String(q.question || "").trim().toLocaleLowerCase("uz");
  if (seen.has(key)) errors.push(`#${i+1}: duplicate question text`);
  seen.add(key);
});
if (errors.length) { console.error(errors.slice(0, 100).join("\n")); console.error(`Total errors: ${errors.length}`); process.exit(1); }
console.log(`OK: ${data.length} questions; schema, options, answer indexes, and exact duplicates passed.`);
