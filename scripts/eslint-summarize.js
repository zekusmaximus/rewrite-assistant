const fs = require('fs');

function readJson(p) {
  const s = fs.readFileSync(p, 'utf8');
  return JSON.parse(s);
}

function tally(results) {
  let errors = 0, warnings = 0;
  let fixableErrors = 0, fixableWarnings = 0;
  const ruleCounts = new Map();
  const fileCounts = new Map();

  for (const r of results) {
    errors += r.errorCount || 0;
    warnings += r.warningCount || 0;
    fixableErrors += r.fixableErrorCount || 0;
    fixableWarnings += r.fixableWarningCount || 0;

    const msgs = r.messages || [];
    if (msgs.length > 0) {
      fileCounts.set(r.filePath, (fileCounts.get(r.filePath) || 0) + msgs.length);
    }
    for (const m of msgs) {
      const id = m.ruleId || '__nonRule__';
      ruleCounts.set(id, (ruleCounts.get(id) || 0) + 1);
    }
  }

  const topRules = Array.from(ruleCounts.entries())
    .filter(([id]) => id !== '__nonRule__')
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([ruleId, count]) => ({ ruleId, count }));

  const topFiles = Array.from(fileCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([filePath, count]) => ({ filePath, count }));

  return {
    errors,
    warnings,
    fixableErrors,
    fixableWarnings,
    totalIssues: errors + warnings,
    topRules,
    topFiles,
  };
}

const before = readJson('eslint-baseline-ts.json');
const after = readJson('eslint-after-fix-ts.json');

const beforeT = tally(before);
const afterT = tally(after);

const summary = { before: beforeT, after: afterT };

console.log(JSON.stringify(summary, null, 2));