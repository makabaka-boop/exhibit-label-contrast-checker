/**
 * 展签配色核验核心公式（WCAG 2.x 相对亮度与对比度定义）。
 * 全部为纯函数，无任何外部调用；裁决一律使用未舍入比值。
 */

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export type FontWeight = 'normal' | 'bold';

/** 仅接受形如 #RRGGBB 的六位十六进制写法（大小写不限，不允许省略 # 或位数不符）。 */
export const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

/** 仅接受普通十进制数字（整数或小数），拒绝 16px、1e3、0x10、Infinity 等写法。 */
export const FONT_SIZE_PATTERN = /^(?:\d+(?:\.\d+)?|\.\d+)$/;

export function parseHexColor(input: string): RgbColor | null {
  if (!HEX_COLOR_PATTERN.test(input)) {
    return null;
  }
  const hex = input.slice(1);
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

/**
 * 单个 sRGB 通道（0–255）转线性值：
 * 通道除以 255 后，不大于 0.04045 时除以 12.92，否则取 ((v + 0.055) / 1.055) ^ 2.4。
 */
export function srgbChannelToLinear(channel: number): number {
  const v = channel / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** 相对亮度 L = 0.2126R + 0.7152G + 0.0722B（R/G/B 为线性化后的值）。 */
export function relativeLuminance(color: RgbColor): number {
  return (
    0.2126 * srgbChannelToLinear(color.r) +
    0.7152 * srgbChannelToLinear(color.g) +
    0.0722 * srgbChannelToLinear(color.b)
  );
}

/** 对比度 = (较亮亮度 + 0.05) / (较暗亮度 + 0.05)，与前景/背景顺序无关。 */
export function contrastRatio(a: RgbColor, b: RgbColor): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** 大号文字：普通字重 ≥ 24px，或粗体 ≥ 18.66px。 */
export function isLargeText(fontSizePx: number, weight: FontWeight): boolean {
  return weight === 'bold' ? fontSizePx >= 18.66 : fontSizePx >= 24;
}

export const CONTRAST_THRESHOLDS = {
  normal: { AA: 4.5, AAA: 7 },
  large: { AA: 3, AAA: 4.5 },
} as const;

export interface ContrastVerdicts {
  normalAA: boolean;
  normalAAA: boolean;
  largeAA: boolean;
  largeAAA: boolean;
}

/** 用未舍入比值裁决，等于阈值即视为通过。 */
export function evaluateContrast(ratio: number): ContrastVerdicts {
  return {
    normalAA: ratio >= CONTRAST_THRESHOLDS.normal.AA,
    normalAAA: ratio >= CONTRAST_THRESHOLDS.normal.AAA,
    largeAA: ratio >= CONTRAST_THRESHOLDS.large.AA,
    largeAAA: ratio >= CONTRAST_THRESHOLDS.large.AAA,
  };
}

export interface VerificationResult {
  foreground: string;
  background: string;
  fontSizePx: number;
  weight: FontWeight;
  isLargeText: boolean;
  ratio: number;
  verdicts: ContrastVerdicts;
}

/** 对已校验通过的输入计算完整结果。 */
export function verifyContrast(input: {
  foreground: string;
  background: string;
  fontSizePx: number;
  weight: FontWeight;
}): VerificationResult {
  const fg = parseHexColor(input.foreground);
  const bg = parseHexColor(input.background);
  if (!fg || !bg) {
    throw new Error('verifyContrast 只接受 #RRGGBB 形式的色值');
  }
  const ratio = contrastRatio(fg, bg);
  return {
    foreground: input.foreground,
    background: input.background,
    fontSizePx: input.fontSizePx,
    weight: input.weight,
    isLargeText: isLargeText(input.fontSizePx, input.weight),
    ratio,
    verdicts: evaluateContrast(ratio),
  };
}

export interface FormErrors {
  foreground?: string;
  background?: string;
  fontSize?: string;
}

export interface ValidationOutcome {
  errors: FormErrors;
  fontSizePx: number | null;
}

/** 表单校验：任一字段非法时给出对应错误，调用方据此保留上一份有效结果。 */
export function validateInputs(input: {
  foreground: string;
  background: string;
  fontSize: string;
}): ValidationOutcome {
  const errors: FormErrors = {};
  if (!parseHexColor(input.foreground)) {
    errors.foreground = '前景色必须是 #RRGGBB 形式的六位十六进制色值';
  }
  if (!parseHexColor(input.background)) {
    errors.background = '背景色必须是 #RRGGBB 形式的六位十六进制色值';
  }
  const trimmed = input.fontSize.trim();
  const parsed = FONT_SIZE_PATTERN.test(trimmed) ? Number(trimmed) : Number.NaN;
  let fontSizePx: number | null = null;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    errors.fontSize = '字号必须是大于 0 的数字（CSS 像素）';
  } else {
    fontSizePx = parsed;
  }
  return { errors, fontSizePx };
}

/** 展示用：四舍五入到两位小数（裁决仍基于未舍入值）。 */
export function formatRatio(ratio: number): string {
  return ratio.toFixed(2);
}

/** 与结果卡完全一致的纯文本摘要。 */
export function buildPlainTextSummary(result: VerificationResult): string {
  const pass = (ok: boolean) => (ok ? '通过' : '未通过');
  return [
    `前景色: ${result.foreground}`,
    `背景色: ${result.background}`,
    `字号: ${result.fontSizePx}px`,
    `字重: ${result.weight === 'bold' ? '粗体' : '普通'}`,
    `文字分类: ${result.isLargeText ? '大号文字' : '普通文字'}`,
    `对比度: ${formatRatio(result.ratio)}`,
    `普通文字 AA: ${pass(result.verdicts.normalAA)}`,
    `普通文字 AAA: ${pass(result.verdicts.normalAAA)}`,
    `大号文字 AA: ${pass(result.verdicts.largeAA)}`,
    `大号文字 AAA: ${pass(result.verdicts.largeAAA)}`,
  ].join('\n');
}
