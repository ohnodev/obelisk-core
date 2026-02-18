/**
 * CLI test script for profit card generation.
 * Usage: npx ts-node scripts/generate-profit-card.ts
 */
import path from "path";
import fs from "fs";
import { generateProfitCard, type ProfitCardData } from "../src/utils/profitCard";

export { generateProfitCard, type ProfitCardData };

const OUTPUT_DIR = path.join(__dirname, "../../data");

async function main() {
  const testData: ProfitCardData = {
    tokenName: "TANKCLAW",
    chain: "BASE",
    action: "BUY",
    profitPercent: 12300,
    initialEth: 0.3,
    positionEth: 36.9,
    ethUsdPrice: 1994,
    holdTime: "72hrs",
  };

  console.log("Generating profit card...");
  const buf = await generateProfitCard(testData);

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const outPath = path.join(OUTPUT_DIR, "profit-card-test.png");
  fs.writeFileSync(outPath, buf);
  console.log(`Saved to ${outPath} (${buf.length} bytes)`);

  const sellData: ProfitCardData = {
    tokenName: "PIXEL",
    chain: "BASE",
    action: "SELL",
    profitPercent: -4.3,
    initialEth: 0.001,
    positionEth: 0.000957,
    ethUsdPrice: 2650,
    holdTime: "5m",
  };

  const buf2 = await generateProfitCard(sellData);
  const outPath2 = path.join(OUTPUT_DIR, "profit-card-test-sell.png");
  fs.writeFileSync(outPath2, buf2);
  console.log(`Saved to ${outPath2} (${buf2.length} bytes)`);

  // ETH-only card (no USD price available)
  const ethOnlyData: ProfitCardData = {
    tokenName: "NOPRICEYET",
    chain: "BASE",
    action: "BUY",
    profitPercent: 0,
    initialEth: 0.05,
    positionEth: 0.05,
  };

  const buf3 = await generateProfitCard(ethOnlyData);
  const outPath3 = path.join(OUTPUT_DIR, "profit-card-test-eth-only.png");
  fs.writeFileSync(outPath3, buf3);
  console.log(`Saved to ${outPath3} (${buf3.length} bytes)`);
}

main().catch(console.error);
