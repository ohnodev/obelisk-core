/**
 * Test: parseWethReceivedByAddress correctly sums WETH Transfer logs TO our address.
 * Uses receipt from Base sell tx 0x223d4f3ff7e89e082af1fb11bc2c8b0b081fbab7bf7d79a6c32e82287285b4fe
 * (From: 0x8ea25bF544C49C4846bC69432F328cf1DDa91110, received 0.000956766492301913 ETH).
 *
 * Run: npm test -- parse-weth-received
 */
import { describe, it, expect } from "vitest";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";

for (const rel of [
  path.join("..", "..", ".env"),
  path.join("..", "..", "blockchain-service", ".env"),
]) {
  const envPath = path.resolve(__dirname, rel);
  if (fs.existsSync(envPath)) dotenv.config({ path: envPath });
}

import {
  parseWethReceivedByAddress,
  type TransactionReceiptLike,
} from "../src/utils/cabalSwapper";

const OUR_ADDRESS = "0x8ea25bF544C49C4846bC69432F328cf1DDa91110";
const EXPECTED_WEI = "956766492301913"; // 0.000956766492301913 ETH (from BaseScan log 1141)
const WETH_TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const WETH_ADDRESS = "0x4200000000000000000000000000000000000006";

describe("parseWethReceivedByAddress", () => {
  it("should return WETH transferred TO our address from fixture (Base sell tx)", () => {
    // Single WETH Transfer log: to = OUR_ADDRESS, value = 956766492301913 (from BaseScan log 1141)
    const receipt: TransactionReceiptLike = {
      logs: [
        {
          address: WETH_ADDRESS,
          topics: [
            WETH_TRANSFER_TOPIC,
            "0x000000000000000000000000b23967a0de1f574bd756de89a08cfe4d7372889f", // from
            "0x0000000000000000000000008ea25bf544c49c4846bc69432f328cf1dda91110", // to = our address
          ],
          data: "0x" + BigInt(EXPECTED_WEI).toString(16).padStart(64, "0"),
        },
      ],
    };
    const result = parseWethReceivedByAddress(receipt, OUR_ADDRESS);
    expect(result).toBe(EXPECTED_WEI);
  });

  it("should return 0 when our address is not recipient of any WETH Transfer", () => {
    const receipt: TransactionReceiptLike = {
      logs: [
        {
          address: WETH_ADDRESS,
          topics: [
            WETH_TRANSFER_TOPIC,
            "0x000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "0x000000000000000000000000bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          ],
          data: "0x" + "1".padStart(64, "0"),
        },
      ],
    };
    expect(parseWethReceivedByAddress(receipt, OUR_ADDRESS)).toBe("0");
  });

  it("should sum multiple WETH transfers to our address", () => {
    const receipt: TransactionReceiptLike = {
      logs: [
        {
          address: WETH_ADDRESS,
          topics: [
            WETH_TRANSFER_TOPIC,
            "0x000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "0x0000000000000000000000008ea25bf544c49c4846bc69432f328cf1dda91110",
          ],
          data: "0x" + BigInt(100).toString(16).padStart(64, "0"),
        },
        {
          address: WETH_ADDRESS,
          topics: [
            WETH_TRANSFER_TOPIC,
            "0x000000000000000000000000cccccccccccccccccccccccccccccccccccccccc",
            "0x0000000000000000000000008ea25bf544c49c4846bc69432f328cf1dda91110",
          ],
          data: "0x" + BigInt(200).toString(16).padStart(64, "0"),
        },
      ],
    };
    expect(parseWethReceivedByAddress(receipt, OUR_ADDRESS)).toBe("300");
  });

  it("should ignore non-WETH or non-Transfer logs", () => {
    const receipt: TransactionReceiptLike = {
      logs: [
        {
          address: "0x8b0cb04bf78d40009f579f9eaa0ca7ee4b956b07",
          topics: [WETH_TRANSFER_TOPIC, "0x0", "0x0000000000000000000000008ea25bf544c49c4846bc69432f328cf1dda91110"],
          data: "0x" + "1".padStart(64, "0"),
        },
        {
          address: WETH_ADDRESS,
          topics: [
            WETH_TRANSFER_TOPIC,
            "0x000000000000000000000000b23967a0de1f574bd756de89a08cfe4d7372889f",
            "0x0000000000000000000000008ea25bf544c49c4846bc69432f328cf1dda91110",
          ],
          data: "0x" + BigInt(EXPECTED_WEI).toString(16).padStart(64, "0"),
        },
      ],
    };
    expect(parseWethReceivedByAddress(receipt, OUR_ADDRESS)).toBe(EXPECTED_WEI);
  });
});

describe("parseWethReceivedByAddress with live receipt (optional)", () => {
  it("should parse real Base sell tx and return 0.000956766492301913 ETH wei", async () => {
    const rpc = process.env.RPC_URL;
    if (!rpc) {
      return; // skip without RPC
    }
    const provider = new (await import("ethers")).JsonRpcProvider(rpc);
    const txHash = "0x223d4f3ff7e89e082af1fb11bc2c8b0b081fbab7bf7d79a6c32e82287285b4fe";
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt?.logs?.length) {
      return; // skip if tx not found or no logs
    }
    const receiptLike: TransactionReceiptLike = {
      logs: receipt.logs.map((l: { address: string; topics: string[]; data: string }) => ({
        address: l.address,
        topics: l.topics as string[],
        data: l.data,
      })),
    };
    const result = parseWethReceivedByAddress(receiptLike, OUR_ADDRESS);
    expect(result).toBe(EXPECTED_WEI);
  }, 15_000);
});
