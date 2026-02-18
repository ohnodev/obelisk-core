/**
 * Profit Card Generator – creates shareable trade result images.
 *
 * Uses node-canvas to overlay trade data onto the DEEP AI background.
 * Font: TT Hoves Pro (assets/deepentry/tt_hoves_pro/)
 * Background: assets/deepentry/profit-card-v1.jpg
 */
import path from "path";
import { createCanvas, loadImage, registerFont, type CanvasRenderingContext2D } from "canvas";

// ── Paths (overridable via DEEPENTRY_ASSETS_DIR env var) ──────────
const ASSETS_DIR = process.env.DEEPENTRY_ASSETS_DIR
  ? path.resolve(process.env.DEEPENTRY_ASSETS_DIR)
  : path.join(__dirname, "../../../assets/deepentry");
const FONTS_DIR = path.join(ASSETS_DIR, "tt_hoves_pro");
const BG_IMAGE = path.join(ASSETS_DIR, "profit-card-v1.jpg");

// ── Lazy font registration + background cache ────────────────────
let fontsRegistered = false;
let cachedBgPromise: ReturnType<typeof loadImage> | null = null;

function ensureFontsRegistered(): void {
  if (fontsRegistered) return;
  fontsRegistered = true;
  const fonts: Array<[string, { family: string; weight: string }]> = [
    ["TT Hoves Pro Trial Bold.ttf", { family: "TT Hoves", weight: "bold" }],
    ["TT Hoves Pro Trial Medium.ttf", { family: "TT Hoves", weight: "500" }],
    ["TT Hoves Pro Trial Regular.ttf", { family: "TT Hoves", weight: "normal" }],
    ["TT Hoves Pro Trial ExtraBold.ttf", { family: "TT Hoves", weight: "800" }],
    ["TT Hoves Pro Trial Black.ttf", { family: "TT Hoves", weight: "900" }],
  ];
  for (const [file, opts] of fonts) {
    try {
      registerFont(path.join(FONTS_DIR, file), opts);
    } catch {
      // Font missing — canvas will fall back to system fonts
    }
  }
}

function loadBackground(): ReturnType<typeof loadImage> {
  if (!cachedBgPromise) cachedBgPromise = loadImage(BG_IMAGE);
  return cachedBgPromise;
}

// ── Colors ────────────────────────────────────────────────────────
const GREEN = "#BDFF00";
const RED = "#FF4444";
const WHITE = "#FFFFFF";
const GRAY = "#9CA3AF";

// ── Canvas dimensions ─────────────────────────────────────────────
const WIDTH = 1024;
const HEIGHT = 680;

// ── Types ─────────────────────────────────────────────────────────
export interface ProfitCardData {
  tokenName: string;
  chain: string;
  action: "BUY" | "SELL";
  profitPercent: number;
  initialEth: number;
  positionEth: number;
  /** If provided, USD values are computed from ETH * ethUsdPrice */
  ethUsdPrice?: number;
  /** Override: explicit USD values (take priority over ethUsdPrice) */
  initialUsd?: number;
  positionUsd?: number;
  holdTime?: string;
}

// ── Helpers ───────────────────────────────────────────────────────
function formatUsd(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${v.toLocaleString("en-US", { maximumFractionDigits: 1 })}`;
  if (v >= 1) return `$${v.toFixed(1)}`;
  return `$${v.toFixed(4)}`;
}

function formatPercent(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 10_000) return `${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}%`;
  if (abs >= 100) return `${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}%`;
  if (abs >= 1) return `${v.toFixed(1)}%`;
  return `${v.toFixed(2)}%`;
}

function formatEth(v: number): string {
  if (v >= 1) return `${v.toFixed(1)}ETH`;
  if (v >= 0.01) return `${v.toFixed(3)}ETH`;
  return `${v.toFixed(5)}ETH`;
}

function drawPill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  bgColor: string,
  textColor: string,
  fontSize: number = 16,
) {
  ctx.save();
  ctx.font = `bold ${fontSize}px "TT Hoves"`;
  const metrics = ctx.measureText(text);
  const padX = 12;
  const padY = 6;
  const w = metrics.width + padX * 2;
  const h = fontSize + padY * 2;
  const r = h / 2;

  ctx.fillStyle = bgColor;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + r, r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = textColor;
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + padX, y + h / 2);
  ctx.restore();

  return w;
}

// ── Main generator ────────────────────────────────────────────────
export async function generateProfitCard(data: ProfitCardData): Promise<Buffer> {
  ensureFontsRegistered();
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  // 1. Draw background image (cached after first load)
  const bg = await loadBackground();
  const bgAspect = bg.width / bg.height;
  const canvasAspect = WIDTH / HEIGHT;
  let drawW: number, drawH: number, drawX: number, drawY: number;
  if (bgAspect > canvasAspect) {
    drawH = HEIGHT;
    drawW = HEIGHT * bgAspect;
    drawX = (WIDTH - drawW) / 2;
    drawY = 0;
  } else {
    drawW = WIDTH;
    drawH = WIDTH / bgAspect;
    drawX = 0;
    drawY = (HEIGHT - drawH) / 2;
  }
  ctx.drawImage(bg, drawX, drawY, drawW, drawH);

  // 2. Dark overlay on left side for text readability
  const grad = ctx.createLinearGradient(0, 0, WIDTH, 0);
  grad.addColorStop(0, "rgba(0, 0, 0, 0.82)");
  grad.addColorStop(0.55, "rgba(0, 0, 0, 0.65)");
  grad.addColorStop(1, "rgba(0, 0, 0, 0.15)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const isProfit = data.profitPercent >= 0;
  const accentColor = isProfit ? GREEN : RED;
  const leftMargin = 60;

  // 3. Token name / chain + action badge
  ctx.textBaseline = "alphabetic";
  ctx.font = `bold 28px "TT Hoves"`;
  ctx.fillStyle = accentColor;
  const tokenLabel = `${data.tokenName}/${data.chain}`;
  ctx.fillText(tokenLabel, leftMargin, 75);

  const tokenWidth = ctx.measureText(tokenLabel).width;
  drawPill(
    ctx,
    leftMargin + tokenWidth + 16,
    75 - 22,
    data.action,
    accentColor,
    "#000000",
    14,
  );

  // 4. Big percentage
  const percentText = formatPercent(data.profitPercent);
  ctx.font = `900 120px "TT Hoves"`;
  ctx.fillStyle = accentColor;
  ctx.fillText(percentText, leftMargin, 240);

  // 5. Stats section - Initial / Position columns
  const statsY = 310;
  const col1X = leftMargin;
  const col2X = leftMargin + 200;

  const initUsd = data.initialUsd ?? (data.ethUsdPrice ? data.initialEth * data.ethUsdPrice : 0);
  const posUsd = data.positionUsd ?? (data.ethUsdPrice ? data.positionEth * data.ethUsdPrice : 0);
  const hasUsd = initUsd > 0 || posUsd > 0;

  // "Initial" label
  ctx.font = `500 18px "TT Hoves"`;
  ctx.fillStyle = GRAY;
  ctx.fillText("Initial", col1X, statsY);

  // "Position" label + hold time badge
  ctx.fillText("Position", col2X, statsY);
  if (data.holdTime) {
    drawPill(ctx, col2X + 90, statsY - 16, data.holdTime, accentColor, "#000000", 12);
  }

  if (hasUsd) {
    ctx.font = `bold 36px "TT Hoves"`;
    ctx.fillStyle = WHITE;
    ctx.fillText(formatUsd(initUsd), col1X, statsY + 50);
    ctx.fillText(formatUsd(posUsd), col2X, statsY + 50);

    ctx.font = `500 16px "TT Hoves"`;
    ctx.fillStyle = GRAY;
    ctx.fillText(formatEth(data.initialEth), col1X, statsY + 80);
    ctx.fillText(formatEth(data.positionEth), col2X, statsY + 80);
  } else {
    ctx.font = `bold 36px "TT Hoves"`;
    ctx.fillStyle = WHITE;
    ctx.fillText(formatEth(data.initialEth), col1X, statsY + 50);
    ctx.fillText(formatEth(data.positionEth), col2X, statsY + 50);
  }

  // 6. Tagline + URL
  ctx.font = `bold 16px "TT Hoves"`;
  ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
  ctx.fillText("Get that DEEP DEEP Entry with Deep Entry AI", leftMargin, HEIGHT - 65);
  ctx.font = `500 14px "TT Hoves"`;
  ctx.fillStyle = accentColor;
  ctx.fillText("trade.deepentryai.com", leftMargin, HEIGHT - 40);

  return canvas.toBuffer("image/png");
}
