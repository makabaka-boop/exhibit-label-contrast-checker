import { describe, expect, it } from 'vitest';
import {
  buildPlainTextSummary,
  contrastRatio,
  evaluateContrast,
  formatRatio,
  isLargeText,
  parseHexColor,
  relativeLuminance,
  srgbChannelToLinear,
  validateInputs,
  verifyContrast,
} from '../src/lib/contrast';

describe('parseHexColor：只接受 #RRGGBB', () => {
  it('解析合法的六位十六进制（大小写均可）', () => {
    expect(parseHexColor('#000000')).toEqual({ r: 0, g: 0, b: 0 });
    expect(parseHexColor('#FFFFFF')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHexColor('#1a2B3c')).toEqual({ r: 26, g: 43, b: 60 });
  });

  it('拒绝任何变形写法', () => {
    const invalid = [
      '',
      '#',
      '000000',
      '#12345',
      '#1234567',
      '#GGGGGG',
      '#123 56',
      ' #123456',
      '#123456 ',
      '#１２３４５６',
      '##123456',
    ];
    for (const bad of invalid) {
      expect(parseHexColor(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe('srgbChannelToLinear：分段公式', () => {
  it('v ≤ 0.04045 时走线性段（除以 12.92）', () => {
    // 10/255 ≈ 0.03922 ≤ 0.04045
    expect(srgbChannelToLinear(10)).toBeCloseTo(10 / 255 / 12.92, 12);
    expect(srgbChannelToLinear(0)).toBe(0);
  });

  it('v > 0.04045 时走幂次段', () => {
    // 11/255 ≈ 0.04314 > 0.04045
    expect(srgbChannelToLinear(11)).toBeCloseTo(Math.pow((11 / 255 + 0.055) / 1.055, 2.4), 12);
    expect(srgbChannelToLinear(255)).toBeCloseTo(1, 12);
  });

  it('v 恰等于 0.04045 的通道仍属线性段（“不大于”含等于）', () => {
    const boundaryChannel = 0.04045 * 255; // 10.31475
    expect(srgbChannelToLinear(boundaryChannel)).toBeCloseTo(0.04045 / 12.92, 12);
  });
});

describe('relativeLuminance 与 contrastRatio', () => {
  it('黑色亮度为 0，白色亮度为 1', () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBe(0);
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 12);
  });

  it('黑白对比度为 21，且与前景/背景顺序无关', () => {
    const black = { r: 0, g: 0, b: 0 };
    const white = { r: 255, g: 255, b: 255 };
    expect(contrastRatio(black, white)).toBeCloseTo(21, 10);
    expect(contrastRatio(white, black)).toBeCloseTo(21, 10);
  });

  it('相同颜色对比度为 1', () => {
    const c = { r: 18, g: 52, b: 86 };
    expect(contrastRatio(c, c)).toBeCloseTo(1, 12);
  });

  it('经典临界值：#777777 对白 ≈ 4.478（低于 4.5）', () => {
    const gray = parseHexColor('#777777')!;
    const white = parseHexColor('#FFFFFF')!;
    expect(contrastRatio(gray, white)).toBeCloseTo(4.478, 2);
  });

  it('经典临界值：#767676 对白 ≈ 4.542（高于 4.5）', () => {
    const gray = parseHexColor('#767676')!;
    const white = parseHexColor('#FFFFFF')!;
    expect(contrastRatio(gray, white)).toBeCloseTo(4.542, 2);
  });
});

describe('isLargeText：大号文字分类边界', () => {
  it('普通字重需 ≥ 24px', () => {
    expect(isLargeText(24, 'normal')).toBe(true);
    expect(isLargeText(23.99, 'normal')).toBe(false);
  });

  it('粗体需 ≥ 18.66px', () => {
    expect(isLargeText(18.66, 'bold')).toBe(true);
    expect(isLargeText(18.65, 'bold')).toBe(false);
  });

  it('普通字重 18.66px 不算大号，粗体 24px 仍算大号', () => {
    expect(isLargeText(18.66, 'normal')).toBe(false);
    expect(isLargeText(24, 'bold')).toBe(true);
  });
});

describe('evaluateContrast：阈值裁决（未舍入、含等于）', () => {
  it('普通文字 AA：恰等于 4.5 通过，略低不通过', () => {
    expect(evaluateContrast(4.5).normalAA).toBe(true);
    expect(evaluateContrast(4.4999).normalAA).toBe(false);
  });

  it('普通文字 AAA：恰等于 7 通过，略低不通过', () => {
    expect(evaluateContrast(7).normalAAA).toBe(true);
    expect(evaluateContrast(6.9999).normalAAA).toBe(false);
  });

  it('大号文字 AA：恰等于 3 通过，略低不通过', () => {
    expect(evaluateContrast(3).largeAA).toBe(true);
    expect(evaluateContrast(2.9999).largeAA).toBe(false);
  });

  it('大号文字 AAA：恰等于 4.5 通过，略低不通过', () => {
    expect(evaluateContrast(4.5).largeAAA).toBe(true);
    expect(evaluateContrast(4.4999).largeAAA).toBe(false);
  });

  it('裁决基于未舍入值：4.496 展示为 4.50 但普通 AA 仍不通过', () => {
    const ratio = 4.496;
    expect(formatRatio(ratio)).toBe('4.50');
    expect(evaluateContrast(ratio).normalAA).toBe(false);
    expect(evaluateContrast(ratio).largeAAA).toBe(false);
  });

  it('1:1 全部不通过，21:1 全部通过', () => {
    expect(evaluateContrast(1)).toEqual({
      normalAA: false,
      normalAAA: false,
      largeAA: false,
      largeAAA: false,
    });
    expect(evaluateContrast(21)).toEqual({
      normalAA: true,
      normalAAA: true,
      largeAA: true,
      largeAAA: true,
    });
  });
});

describe('validateInputs：逐字段校验', () => {
  it('合法输入无错误并解析出字号', () => {
    const { errors, fontSizePx } = validateInputs({
      foreground: '#112233',
      background: '#FFFFFF',
      fontSize: '16',
    });
    expect(errors).toEqual({});
    expect(fontSizePx).toBe(16);
  });

  it('三个字段的非法互不影响，各自报错', () => {
    const { errors, fontSizePx } = validateInputs({
      foreground: 'red',
      background: '#12345',
      fontSize: '0',
    });
    expect(errors.foreground).toBeTruthy();
    expect(errors.background).toBeTruthy();
    expect(errors.fontSize).toBeTruthy();
    expect(fontSizePx).toBeNull();
  });

  it('字号必须大于 0，且只接受普通十进制数字', () => {
    const invalidSizes = ['0', '-3', '0.0', 'abc', '16px', '1e3', '0x10', '', 'Infinity', 'NaN'];
    for (const fontSize of invalidSizes) {
      const { errors, fontSizePx } = validateInputs({
        foreground: '#000000',
        background: '#FFFFFF',
        fontSize,
      });
      expect(errors.fontSize, JSON.stringify(fontSize)).toBeTruthy();
      expect(fontSizePx).toBeNull();
    }
  });

  it('接受小数与临界分类字号', () => {
    expect(
      validateInputs({ foreground: '#000000', background: '#FFFFFF', fontSize: '18.66' }).fontSizePx,
    ).toBe(18.66);
    expect(
      validateInputs({ foreground: '#000000', background: '#FFFFFF', fontSize: ' 24 ' }).fontSizePx,
    ).toBe(24);
  });
});

describe('verifyContrast：完整结果', () => {
  it('#777777 / #FFFFFF、20px 粗体 → 大号文字，普通 AA 不通过、大号 AA 通过', () => {
    const r = verifyContrast({ foreground: '#777777', background: '#FFFFFF', fontSizePx: 20, weight: 'bold' });
    expect(r.isLargeText).toBe(true);
    expect(r.ratio).toBeCloseTo(4.478, 2);
    expect(r.verdicts).toEqual({
      normalAA: false,
      normalAAA: false,
      largeAA: true,
      largeAAA: false,
    });
  });

  it('非法色值直接抛错（调用方须先校验）', () => {
    expect(() =>
      verifyContrast({ foreground: '#12345', background: '#FFFFFF', fontSizePx: 16, weight: 'normal' }),
    ).toThrow();
  });
});

describe('buildPlainTextSummary：摘要与结果一致', () => {
  it('黑白 16px 普通字重的摘要逐行一致', () => {
    const r = verifyContrast({ foreground: '#000000', background: '#FFFFFF', fontSizePx: 16, weight: 'normal' });
    expect(buildPlainTextSummary(r)).toBe(
      [
        '前景色: #000000',
        '背景色: #FFFFFF',
        '字号: 16px',
        '字重: 普通',
        '文字分类: 普通文字',
        '对比度: 21.00',
        '普通文字 AA: 通过',
        '普通文字 AAA: 通过',
        '大号文字 AA: 通过',
        '大号文字 AAA: 通过',
      ].join('\n'),
    );
  });

  it('临界样例 #777777 的摘要展示舍入值、裁决用未舍入值', () => {
    const r = verifyContrast({ foreground: '#777777', background: '#FFFFFF', fontSizePx: 12, weight: 'normal' });
    const summary = buildPlainTextSummary(r);
    expect(summary).toContain('对比度: 4.48');
    expect(summary).toContain('普通文字 AA: 未通过');
    expect(summary).toContain('大号文字 AA: 通过');
    expect(summary).toContain('大号文字 AAA: 未通过');
  });
});
