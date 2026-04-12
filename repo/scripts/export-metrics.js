#!/usr/bin/env node
/**
 * Export current Prometheus metrics to stdout.
 * Useful for spot-checking metrics in non-production environments.
 *
 * Run: node scripts/export-metrics.js
 */

import { registry } from '../src/common/metrics/metrics.js';

async function run() {
  const metrics = await registry.metrics();
  process.stdout.write(metrics);
}

run()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
