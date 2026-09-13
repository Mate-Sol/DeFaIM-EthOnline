#!/usr/bin/env node
'use strict';

/**
 * DeFa risk monitor.
 *
 * Reads live facility state from the Subgraph and decides what a human needs
 * to look at. Run it on a schedule, or once from the CLI:
 *
 *   node agent/src/index.js                 # human-readable
 *   node agent/src/index.js --json          # machine-readable
 *   node agent/src/index.js --demo-clock    # 60s contract day (demo factory)
 *
 * Exit code is 1 when anything CRITICAL is outstanding, so it can gate a
 * check or page someone without further parsing.
 */

const { fetchFacilities } = require('./graph');
const { evaluate } = require('./rules');

const ICON = { CRITICAL: '!!', WARNING: ' !', INFO: '  ' };

async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  // The demo factory builds with MathLib.SECONDS_PER_DAY = 60, so a contract
  // day passes in a real minute. Judging "days overdue" on the wrong clock
  // makes every demo facility look catastrophically late.
  const secondsPerDay = args.includes('--demo-clock') ? 60 : 86400;

  const { facilities, meta } = await fetchFacilities();
  const now = Number(meta?.block?.timestamp ?? Math.floor(Date.now() / 1000));
  const findings = evaluate(facilities, { now, secondsPerDay });

  if (asJson) {
    console.log(JSON.stringify({ meta, checked: facilities.length, findings }, null, 2));
  } else {
    console.log(`DeFa risk monitor — ${facilities.length} facilities`);
    console.log(`indexed to block ${meta?.block?.number}${meta?.hasIndexingErrors ? ' (INDEXING ERRORS)' : ''}`);
    console.log('');
    if (findings.length === 0) {
      console.log('No findings.');
    } else {
      for (const f of findings) {
        console.log(`${ICON[f.severity]} [${f.severity}] ${f.rule}`);
        console.log(`   ${f.message}`);
      }
      console.log('');
      const counts = findings.reduce((a, f) => ({ ...a, [f.severity]: (a[f.severity] ?? 0) + 1 }), {});
      console.log(Object.entries(counts).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(' · '));
    }
  }

  process.exitCode = findings.some((f) => f.severity === 'CRITICAL') ? 1 : 0;
}

main().catch((e) => {
  console.error(`risk monitor failed: ${e.message}`);
  process.exitCode = 2;
});
