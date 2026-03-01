import { BaseNode, ExecutionContext } from "../nodeBase";
import { getLogger } from "../../../utils/logger";
import { ethers, Wallet } from "ethers";
import {
  asString,
  callBasemarket,
  resolveBaseUrl,
  resolvePrivateKey,
  resolveUserAddress,
} from "./basemarketShared";

const logger = getLogger("basemarketTradeAction");

type SigningConfig = {
  chainId: number;
  orderbookAddress: string;
  usdcAddress: string;
  closeOrderFee: string;
  currentRound: string;
};

type SignatureAuthorization = {
  validAfter: string;
  validBefore: string;
  nonce: string;
  signature: string;
};

const ACTION_ENDPOINTS: Record<string, string> = {
  "mint_complete_set": "/v1/trade/mint-complete-set",
  mint: "/v1/trade/mint-complete-set",
  open_sell: "/v1/trade/sell",
  sell: "/v1/trade/sell",
  open_buy: "/v1/trade/buy",
  buy: "/v1/trade/buy",
  close_sell: "/v1/trade/close",
  close_buy: "/v1/trade/close",
  close_all_orders: "/v1/trade/close",
  close_all: "/v1/trade/close",
  close: "/v1/trade/close",
  refund: "/v1/trade/refund",
  redeem: "/v1/trade/redeem",
  merge_complete_set: "/v1/trade/merge-complete-set",
  merge: "/v1/trade/merge-complete-set",
};

function normalizeAction(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/-/g, "_")
    .replace(/\s+/g, "_");
}

function parsePayload(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return {};
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

function parsePositiveBigInt(value: unknown): bigint | null {
  if (typeof value === "bigint") return value > 0n ? value : null;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) return null;
    return BigInt(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const parsed = BigInt(trimmed);
    return parsed > 0n ? parsed : null;
  }
  return null;
}

function parseOutcome(value: unknown): "YES" | "NO" | null {
  const normalized = asString(value).toUpperCase();
  if (normalized === "YES") return "YES";
  if (normalized === "NO") return "NO";
  return null;
}

function mapAuthPayload(auth: { validAfter: bigint; validBefore: bigint; nonce: string; signature: string }): SignatureAuthorization {
  return {
    validAfter: auth.validAfter.toString(),
    validBefore: auth.validBefore.toString(),
    nonce: auth.nonce,
    signature: auth.signature,
  };
}

function buildAuthWindow() {
  const validAfter = 0n;
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const nonce = ethers.hexlify(ethers.randomBytes(32));
  return { validAfter, validBefore, nonce };
}

function parsePositionsResponse(data: Record<string, unknown>): Array<Record<string, unknown>> {
  const positions = data.positions;
  return Array.isArray(positions)
    ? positions.filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
    : [];
}

function parsePortfolioEntries(data: Record<string, unknown>): Array<Record<string, unknown>> {
  const entries = data.entries;
  return Array.isArray(entries)
    ? entries.filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
    : [];
}

export class BasemarketTradeActionNode extends BaseNode {
  private async getSigningConfig(baseUrl: string, userAddress: string): Promise<SigningConfig> {
    const response = await callBasemarket(
      baseUrl,
      `/v1/trade/signing-config?user=${encodeURIComponent(userAddress)}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          "x-user-address": userAddress,
        },
      }
    );
    if (!response.ok) {
      throw new Error(response.error ?? "Failed to fetch signing config");
    }
    return response.data as unknown as SigningConfig;
  }

  private async signUsdcTransfer(
    wallet: Wallet,
    signingConfig: SigningConfig,
    from: string,
    to: string,
    value: bigint
  ): Promise<SignatureAuthorization> {
    const { validAfter, validBefore, nonce } = buildAuthWindow();
    const signature = await wallet.signTypedData(
      {
        name: "USD Coin",
        version: "2",
        chainId: Number(signingConfig.chainId),
        verifyingContract: signingConfig.usdcAddress,
      },
      {
        TransferWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      {
        from,
        to,
        value,
        validAfter,
        validBefore,
        nonce,
      }
    );
    return mapAuthPayload({ validAfter, validBefore, nonce, signature });
  }

  private async signClaimTransfer(
    wallet: Wallet,
    signingConfig: SigningConfig,
    from: string,
    outcome: "YES" | "NO",
    amount: bigint
  ): Promise<SignatureAuthorization> {
    const { validAfter, validBefore, nonce } = buildAuthWindow();
    const signature = await wallet.signTypedData(
      {
        name: "BasemarketClaims",
        version: "1",
        chainId: Number(signingConfig.chainId),
        verifyingContract: signingConfig.orderbookAddress,
      },
      {
        ClaimTransferWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "outcome", type: "uint8" },
          { name: "roundId", type: "uint64" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      {
        from,
        to: signingConfig.orderbookAddress,
        outcome: outcome === "YES" ? 0 : 1,
        roundId: BigInt(signingConfig.currentRound),
        value: amount,
        validAfter,
        validBefore,
        nonce,
      }
    );
    return mapAuthPayload({ validAfter, validBefore, nonce, signature });
  }

  private async signRedeem(
    wallet: Wallet,
    signingConfig: SigningConfig,
    userAddress: string,
    roundId: bigint,
    amount: bigint
  ): Promise<SignatureAuthorization> {
    const { validAfter, validBefore, nonce } = buildAuthWindow();
    const signature = await wallet.signTypedData(
      {
        name: "BasemarketClaims",
        version: "1",
        chainId: Number(signingConfig.chainId),
        verifyingContract: signingConfig.orderbookAddress,
      },
      {
        RedeemClaimsWithAuthorization: [
          { name: "from", type: "address" },
          { name: "recipient", type: "address" },
          { name: "roundId", type: "uint64" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      {
        from: userAddress,
        recipient: userAddress,
        roundId,
        value: amount,
        validAfter,
        validBefore,
        nonce,
      }
    );
    return mapAuthPayload({ validAfter, validBefore, nonce, signature });
  }

  private async signMerge(
    wallet: Wallet,
    signingConfig: SigningConfig,
    userAddress: string,
    roundId: bigint,
    amount: bigint
  ): Promise<SignatureAuthorization> {
    const { validAfter, validBefore, nonce } = buildAuthWindow();
    const signature = await wallet.signTypedData(
      {
        name: "BasemarketClaims",
        version: "1",
        chainId: Number(signingConfig.chainId),
        verifyingContract: signingConfig.orderbookAddress,
      },
      {
        MergeClaimsWithAuthorization: [
          { name: "from", type: "address" },
          { name: "recipient", type: "address" },
          { name: "roundId", type: "uint64" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      {
        from: userAddress,
        recipient: userAddress,
        roundId,
        value: amount,
        validAfter,
        validBefore,
        nonce,
      }
    );
    return mapAuthPayload({ validAfter, validBefore, nonce, signature });
  }

  async execute(context: ExecutionContext): Promise<Record<string, unknown>> {
    const trigger = this.getInputValue("trigger", context, true);
    if (trigger === false || String(trigger).trim().toLowerCase() === "false") {
      return { success: true, skipped: true, reason: "trigger is false" };
    }

    const baseUrl = resolveBaseUrl(this, context);
    const userAddress = resolveUserAddress(this, context);
    const privateKey = resolvePrivateKey(this, context);
    if (!userAddress) {
      return {
        success: false,
        error: "user_address is required",
      };
    }

    const actionRaw =
      this.getInputValue("action", context, undefined) ?? this.metadata.action ?? "mint-complete-set";
    const action = normalizeAction(asString(actionRaw));
    const endpoint = ACTION_ENDPOINTS[action];
    if (!endpoint) {
      return {
        success: false,
        error: `Unsupported action '${action}'. Expected one of: ${Object.keys(ACTION_ENDPOINTS).join(", ")}`,
      };
    }

    const payloadInput = this.getInputValue("payload", context, undefined);
    const metadataPayload = this.metadata.payload;
    const payload = {
      ...parsePayload(metadataPayload),
      ...parsePayload(payloadInput),
    };

    const roundId = this.getInputValue("round_id", context, undefined);
    const currentRound = this.getInputValue("current_round", context, undefined);
    const orderId = this.getInputValue("order_id", context, undefined);
    const outcome = this.getInputValue("outcome", context, undefined);
    const amount = this.getInputValue("amount", context, undefined);
    const price = this.getInputValue("price", context, undefined);
    const signature = this.getInputValue("signature", context, undefined);

    if (roundId !== undefined && roundId !== null && payload.roundId === undefined) payload.roundId = roundId;
    if (currentRound !== undefined && currentRound !== null && payload.roundId === undefined) payload.roundId = currentRound;
    if (orderId !== undefined && orderId !== null && payload.orderId === undefined) payload.orderId = orderId;
    if (outcome !== undefined && outcome !== null && payload.outcome === undefined) payload.outcome = outcome;
    if (amount !== undefined && amount !== null && payload.amount === undefined) payload.amount = amount;
    if (price !== undefined && price !== null && payload.price === undefined) payload.price = price;
    if (signature !== undefined && signature !== null && payload.signature === undefined) payload.signature = signature;

    // refund does not require auth signatures
    if (action === "refund") {
      const providedOrderId = parsePositiveBigInt(payload.orderId);
      const txHashes: string[] = [];
      if (providedOrderId !== null) {
        const single = await callBasemarket(baseUrl, endpoint, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "x-user-address": userAddress,
          },
          body: JSON.stringify({ orderId: providedOrderId.toString() }),
        });
        if (!single.ok) {
          return {
            success: false,
            action,
            endpoint,
            status: single.status,
            error: single.error ?? "Failed refund",
            response: single.data,
          };
        }
        txHashes.push(asString(single.data.txHash ?? single.data.tx_hash ?? ""));
        return {
          success: true,
          action,
          endpoint,
          tx_hash: txHashes[0] || null,
          tx_hashes: txHashes,
          response: single.data,
        };
      }

      // Auto-refund all active past-round orders.
      const signingConfig = await this.getSigningConfig(baseUrl, userAddress);
      const currentRoundNum = Number(signingConfig.currentRound);
      const positionsRes = await callBasemarket(
        baseUrl,
        `/v1/trade/positions?user=${encodeURIComponent(userAddress)}`,
        { method: "GET", headers: { Accept: "application/json", "x-user-address": userAddress } }
      );
      if (!positionsRes.ok) {
        return {
          success: false,
          action,
          endpoint,
          status: positionsRes.status,
          error: positionsRes.error ?? "Failed to fetch positions for refund",
          response: positionsRes.data,
        };
      }
      const positions = parsePositionsResponse(positionsRes.data);
      const targetOrders = positions.filter((p) => {
        const isActive = Boolean(p.isActive);
        const round = Number(p.roundId);
        return isActive && Number.isFinite(round) && round > 0 && round < currentRoundNum;
      });
      for (const pos of targetOrders) {
        const oid = parsePositiveBigInt(pos.orderId);
        if (oid === null) continue;
        const r = await callBasemarket(baseUrl, endpoint, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "x-user-address": userAddress,
          },
          body: JSON.stringify({ orderId: oid.toString() }),
        });
        if (r.ok) {
          const hash = asString(r.data.txHash ?? r.data.tx_hash ?? "");
          if (hash) txHashes.push(hash);
        }
      }
      return {
        success: true,
        action,
        endpoint,
        tx_hash: txHashes[0] ?? null,
        tx_hashes: txHashes,
        refunded_count: txHashes.length,
      };
    }

    if (!privateKey) {
      return {
        success: false,
        action,
        endpoint,
        error: "private_key is required for signed trade actions",
      };
    }

    const wallet = new Wallet(privateKey);
    const signingConfig = await this.getSigningConfig(baseUrl, userAddress);

    const callSignedAction = async (body: Record<string, unknown>) =>
      callBasemarket(baseUrl, endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "x-user-address": userAddress,
        },
        body: JSON.stringify(body),
      });

    const singleActionResponse = async (
      body: Record<string, unknown>
    ): Promise<Record<string, unknown>> => {
      const result = await callSignedAction(body);
      if (!result.ok) {
        return {
          success: false,
          action,
          endpoint,
          status: result.status,
          error: result.error ?? `Failed ${action}`,
          response: result.data,
        };
      }
      const txHash = asString(result.data.txHash ?? result.data.tx_hash ?? result.data.hash);
      const orderIdOut = result.data.orderId ?? result.data.order_id ?? null;
      return {
        success: true,
        action,
        endpoint,
        status: result.status,
        tx_hash: txHash || null,
        order_id: orderIdOut,
        response: result.data,
      };
    };

    if (action === "mint_complete_set" || action === "mint") {
      const collateralAmount =
        parsePositiveBigInt(payload.collateralAmount) ??
        parsePositiveBigInt(payload.amount) ??
        parsePositiveBigInt(payload.usdcAmount);
      if (collateralAmount === null) {
        return { success: false, action, endpoint, error: "collateralAmount/amount/usdcAmount is required" };
      }
      const auth =
        (payload.auth as SignatureAuthorization | undefined) ??
        (await this.signUsdcTransfer(wallet, signingConfig, userAddress, signingConfig.orderbookAddress, collateralAmount));
      return await singleActionResponse({
        maker: userAddress,
        collateralAmount: collateralAmount.toString(),
        auth,
      });
    }

    if (action === "open_sell" || action === "sell") {
      const tokenAmount = parsePositiveBigInt(payload.tokenAmount) ?? parsePositiveBigInt(payload.amount);
      const limitPrice = parsePositiveBigInt(payload.limitPrice) ?? parsePositiveBigInt(payload.price);
      const outcomeValue = parseOutcome(payload.outcome);
      const isMarket = Boolean(payload.isMarket ?? false);
      if (tokenAmount === null || outcomeValue === null) {
        return { success: false, action, endpoint, error: "tokenAmount/amount and outcome(YES|NO) are required" };
      }
      if (!isMarket && limitPrice === null) {
        return { success: false, action, endpoint, error: "limitPrice/price is required for limit open_sell" };
      }
      const auth =
        (payload.auth as SignatureAuthorization | undefined) ??
        (await this.signClaimTransfer(wallet, signingConfig, userAddress, outcomeValue, tokenAmount));
      return await singleActionResponse({
        maker: userAddress,
        outcome: outcomeValue,
        isMarket,
        tokenAmount: tokenAmount.toString(),
        limitPrice: isMarket ? undefined : limitPrice!.toString(),
        auth,
      });
    }

    if (action === "open_buy" || action === "buy") {
      const usdcAmount = parsePositiveBigInt(payload.usdcAmount) ?? parsePositiveBigInt(payload.amount);
      const limitPrice = parsePositiveBigInt(payload.limitPrice) ?? parsePositiveBigInt(payload.price);
      const outcomeValue = parseOutcome(payload.outcome);
      const isMarket = Boolean(payload.isMarket ?? false);
      if (usdcAmount === null || outcomeValue === null) {
        return { success: false, action, endpoint, error: "usdcAmount/amount and outcome(YES|NO) are required" };
      }
      if (!isMarket && limitPrice === null) {
        return { success: false, action, endpoint, error: "limitPrice/price is required for limit open_buy" };
      }
      const auth =
        (payload.auth as SignatureAuthorization | undefined) ??
        (await this.signUsdcTransfer(wallet, signingConfig, userAddress, signingConfig.orderbookAddress, usdcAmount));
      return await singleActionResponse({
        maker: userAddress,
        outcome: outcomeValue,
        isMarket,
        usdcAmount: usdcAmount.toString(),
        limitPrice: isMarket ? undefined : limitPrice!.toString(),
        auth,
      });
    }

    if (
      action === "close" ||
      action === "close_sell" ||
      action === "close_buy" ||
      action === "close_all_orders" ||
      action === "close_all"
    ) {
      const providedOrderId = parsePositiveBigInt(payload.orderId);
      const closeOne = async (oid: bigint) => {
        const auth =
          (payload.auth as SignatureAuthorization | undefined) ??
          (await this.signUsdcTransfer(
            wallet,
            signingConfig,
            userAddress,
            signingConfig.orderbookAddress,
            BigInt(signingConfig.closeOrderFee)
          ));
        return await callSignedAction({
          maker: userAddress,
          orderId: oid.toString(),
          auth,
        });
      };

      if (providedOrderId !== null) {
        const single = await closeOne(providedOrderId);
        if (!single.ok) {
          return {
            success: false,
            action,
            endpoint,
            status: single.status,
            error: single.error ?? "Failed close",
            response: single.data,
          };
        }
        return {
          success: true,
          action,
          endpoint,
          tx_hash: asString(single.data.txHash ?? single.data.tx_hash ?? "") || null,
          response: single.data,
        };
      }

      // Auto-close active orders for selected round.
      const roundFilter =
        parsePositiveBigInt(payload.roundId) ?? parsePositiveBigInt(payload.currentRound) ?? parsePositiveBigInt(signingConfig.currentRound);
      const positionsRes = await callBasemarket(
        baseUrl,
        `/v1/trade/positions?user=${encodeURIComponent(userAddress)}`,
        { method: "GET", headers: { Accept: "application/json", "x-user-address": userAddress } }
      );
      if (!positionsRes.ok) {
        return {
          success: false,
          action,
          endpoint,
          status: positionsRes.status,
          error: positionsRes.error ?? "Failed to fetch positions for close",
          response: positionsRes.data,
        };
      }
      const positions = parsePositionsResponse(positionsRes.data);
      const targetOrders = positions.filter((p) => {
        if (!Boolean(p.isActive)) return false;
        if (Boolean(p.isMarketOrder)) return false;
        const positionRound = parsePositiveBigInt(p.roundId);
        if (roundFilter !== null && positionRound !== roundFilter) return false;
        const isBuy = Boolean(p.isBuyOrder);
        if (action === "close_sell") return !isBuy;
        if (action === "close_buy") return isBuy;
        return true;
      });
      const txHashes: string[] = [];
      for (const pos of targetOrders) {
        const oid = parsePositiveBigInt(pos.orderId);
        if (oid === null) continue;
        const r = await closeOne(oid);
        if (r.ok) {
          const hash = asString(r.data.txHash ?? r.data.tx_hash ?? "");
          if (hash) txHashes.push(hash);
        }
      }
      return {
        success: true,
        action,
        endpoint,
        tx_hash: txHashes[0] ?? null,
        tx_hashes: txHashes,
        closed_count: txHashes.length,
      };
    }

    if (action === "redeem" || action === "merge_complete_set" || action === "merge") {
      const isMerge = action === "merge_complete_set" || action === "merge";
      const doOne = async (round: bigint, amountValue: bigint) => {
        const auth =
          (payload.auth as SignatureAuthorization | undefined) ??
          (isMerge
            ? await this.signMerge(wallet, signingConfig, userAddress, round, amountValue)
            : await this.signRedeem(wallet, signingConfig, userAddress, round, amountValue));
        return await callSignedAction(
          isMerge
            ? {
                maker: userAddress,
                recipient: userAddress,
                roundId: round.toString(),
                amount: amountValue.toString(),
                auth,
              }
            : {
                redeemer: userAddress,
                recipient: userAddress,
                roundId: round.toString(),
                amount: amountValue.toString(),
                auth,
              }
        );
      };

      const providedRound = parsePositiveBigInt(payload.roundId);
      const providedAmount = parsePositiveBigInt(payload.amount);
      if (providedRound !== null && providedAmount !== null) {
        const r = await doOne(providedRound, providedAmount);
        if (!r.ok) {
          return {
            success: false,
            action,
            endpoint,
            status: r.status,
            error: r.error ?? `Failed ${action}`,
            response: r.data,
          };
        }
        return {
          success: true,
          action,
          endpoint,
          tx_hash: asString(r.data.txHash ?? r.data.tx_hash ?? "") || null,
          response: r.data,
        };
      }

      // Auto claim all available via portfolio rounds.
      const portfolio = await callBasemarket(
        baseUrl,
        `/v1/trade/portfolio-rounds?user=${encodeURIComponent(userAddress)}&limit=50`,
        { method: "GET", headers: { Accept: "application/json", "x-user-address": userAddress } }
      );
      if (!portfolio.ok) {
        return {
          success: false,
          action,
          endpoint,
          status: portfolio.status,
          error: portfolio.error ?? "Failed to fetch portfolio rounds",
          response: portfolio.data,
        };
      }
      const entries = parsePortfolioEntries(portfolio.data);
      const txHashes: string[] = [];
      const currentRoundNumber = parsePositiveBigInt(signingConfig.currentRound);
      for (const entry of entries) {
        const round = parsePositiveBigInt(entry.roundId);
        const amountField = isMerge ? entry.mergeableAmount : entry.redeemableAmount;
        const amt = parsePositiveBigInt(amountField);
        if (round === null || amt === null) continue;
        if (!isMerge) {
          const isResolved = Boolean(entry.resolved);
          if (!isResolved) continue;
          if (currentRoundNumber !== null && round >= currentRoundNumber) continue;
        }
        const r = await doOne(round, amt);
        if (r.ok) {
          const hash = asString(r.data.txHash ?? r.data.tx_hash ?? "");
          if (hash) txHashes.push(hash);
        }
      }
      return {
        success: true,
        action,
        endpoint,
        tx_hash: txHashes[0] ?? null,
        tx_hashes: txHashes,
        processed_count: txHashes.length,
      };
    }

    return {
      success: false,
      action,
      endpoint,
      error: `Action '${action}' is not implemented`,
    };
  }
}
