/**
 * One-off script: start default clanker workflow, wait, then GET /stats and /health.
 * Run from obelisk-core/ts: node scripts/test-stats-flow.js
 * Requires: core API on 7779, workflow will start stats listener on 8081.
 */
const fs = require("fs");
const path = require("path");

const API_BASE = "http://localhost:7779/api/v1";
const STATS_BASE = "http://localhost:8081";
const WORKFLOW_PATH = path.join(__dirname, "../../ui/workflows/clanker-autotrader-v1.json");

async function main() {
  const workflow = JSON.parse(fs.readFileSync(WORKFLOW_PATH, "utf8"));

  console.log("1. Starting workflow...");
  const runRes = await fetch(`${API_BASE}/workflow/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workflow }),
  });
  if (!runRes.ok) {
    console.error("Failed to start workflow:", runRes.status, await runRes.text());
    process.exit(1);
  }
  const runJson = await runRes.json();
  console.log("   ", runJson);

  console.log("\n2. Waiting 6s for autonomous nodes (stats listener) to init...");
  await new Promise((r) => setTimeout(r, 6000));

  console.log("\n3. GET", `${STATS_BASE}/health`);
  try {
    const healthRes = await fetch(`${STATS_BASE}/health`);
    const healthJson = await healthRes.json();
    console.log("   ", healthRes.status, healthJson);
  } catch (e) {
    console.error("   Error:", e.message);
  }

  console.log("\n4. GET", `${STATS_BASE}/stats`);
  try {
    const statsRes = await fetch(`${STATS_BASE}/stats`);
    const statsText = await statsRes.text();
    console.log("   Status:", statsRes.status);
    let statsJson;
    try {
      statsJson = JSON.parse(statsText);
      console.log("   Body (parsed):", JSON.stringify(statsJson, null, 2));
      if (statsJson.response) {
        const payload = JSON.parse(statsJson.response);
        console.log("   Stats payload.bags.holdings count:", payload.bags?.holdings?.length ?? 0);
        console.log("   Stats payload.actions count:", payload.actions?.length ?? 0);
      }
    } catch {
      console.log("   Body (raw):", statsText.slice(0, 500));
    }
  } catch (e) {
    console.error("   Error:", e.message);
  }

  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
