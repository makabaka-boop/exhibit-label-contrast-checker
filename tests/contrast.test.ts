import { describe, expect, it } from 'vitest';
import {
  blendChannels,
  buildPlainTextSummary,
  contrastRatio,
  evaluateContrast,
  formatRatio,
  isLargeText,
  parseHexColor,
  relativeLuminance,
  rgbColorToHex,
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

describe('validateInputs：半透明覆盖率校验', () => {
  const base = { foreground: '#000000', background: '#FFFFFF', fontSize: '16' };

  it('合法覆盖率解析为百分数（0, 100]，允许首尾空格与小数', () => {
    for (const [raw, expected] of [
      ['50', 50],
      ['0.5', 0.5],
      ['.5', 0.5],
      ['100', 100],
      [' 25 ', 25],
      ['33.3', 33.3],
    ] as const) {
      const { errors, coveragePercent } = validateInputs({ ...base, inkMode: 'translucent', coverage: raw });
      expect(errors, JSON.stringify(raw)).toEqual({});
      expect(coveragePercent, JSON.stringify(raw)).toBe(expected);
    }
  });

  it('为空、含单位、超界或非有限数时分别给出原因，且不产出覆盖率', () => {
    const cases: Array<[string, RegExp]> = [
      ['', /填写覆盖率/],
      ['   ', /填写覆盖率/],
      ['50%', /纯数字/],
      ['50％', /纯数字/],
      ['50 percent', /纯数字/],
      ['abc', /纯数字/],
      ['1e2', /纯数字/],
      ['0x32', /纯数字/],
      ['NaN', /纯数字/],
      // Infinity 不是“带单位/非数字”，而是非有限数值
      ['Infinity', /有限数值/],
      ['infinity', /有限数值/],
      ['-Infinity', /有限数值/],
      ['+Infinity', /有限数值/],
      ['0', /大于 0 且不超过 100/],
      // 负覆盖率是有限数字，错误原因是超出允许范围而非“不是纯数字”
      ['-5', /超出允许范围/],
      ['-0.01', /超出允许范围/],
      ['100.01', /大于 0 且不超过 100/],
      ['101', /大于 0 且不超过 100/],
    ];
    for (const [raw, reason] of cases) {
      const { errors, coveragePercent } = validateInputs({ ...base, inkMode: 'translucent', coverage: raw });
      expect(errors.coverage, JSON.stringify(raw)).toMatch(reason);
      expect(coveragePercent, JSON.stringify(raw)).toBeNull();
    }
  });

  it('覆盖率错误与其他字段错误互不影响', () => {
    const { errors, fontSizePx, coveragePercent } = validateInputs({
      foreground: 'red',
      background: '#FFFFFF',
      fontSize: '16',
      inkMode: 'translucent',
      coverage: '0',
    });
    expect(errors.foreground).toBeTruthy();
    expect(errors.coverage).toBeTruthy();
    expect(errors.fontSize).toBeUndefined();
    expect(fontSizePx).toBe(16);
    expect(coveragePercent).toBeNull();
  });

  it('不透明（默认）路径不校验覆盖率，结果与不传一致', () => {
    const implicit = validateInputs(base);
    expect(implicit.errors).toEqual({});
    expect(implicit.coveragePercent).toBeNull();

    // 不透明时即使覆盖率字段残留内容也不参与校验
    const explicit = validateInputs({ ...base, inkMode: 'opaque', coverage: '50%' });
    expect(explicit.errors).toEqual({});
    expect(explicit.coveragePercent).toBeNull();
  });
});

describe('blendChannels：逐通道“前景×覆盖率 + 背景×剩余比例”', () => {
  it('黑字 50% 覆盖率落在白底上混合为中灰 #808080（127.5 四舍五入为 128）', () => {
    const blended = blendChannels({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }, 0.5);
    expect(blended).toEqual({ r: 128, g: 128, b: 128 });
    expect(rgbColorToHex(blended)).toBe('#808080');
  });

  it('各通道独立混合并分别四舍五入', () => {
    // r: 0×0.3 + 255×0.7 = 178.5 → 179；g: 100×0.3 + 200×0.7 = 170；b: 255×0.3 + 0×0.7 = 76.5 → 77
    const blended = blendChannels({ r: 0, g: 100, b: 255 }, { r: 255, g: 200, b: 0 }, 0.3);
    expect(blended).toEqual({ r: 179, g: 170, b: 77 });
    expect(rgbColorToHex(blended)).toBe('#B3AA4D');
  });

  it('黑字 30% 覆盖率落在 45 级深灰（#2D2D2D）墙上：各通道 45×0.7=31.5 向上舍入为 32（#202020）', () => {
    // 回归：浮点把 45×0.7 算成 31.499999999999996，朴素 Math.round 会少一档得到 31（#1F1F1F）。
    const wall = { r: 45, g: 45, b: 45 };
    const blended = blendChannels({ r: 0, g: 0, b: 0 }, wall, 0.3);
    expect(blended).toEqual({ r: 32, g: 32, b: 32 });
    expect(rgbColorToHex(blended)).toBe('#202020');
  });

  it('黑字 30% 覆盖率经 verifyContrast 链路得到有效前景色 #202020', () => {
    const r = verifyContrast({
      foreground: '#000000',
      background: '#2D2D2D',
      fontSizePx: 16,
      weight: 'normal',
      coveragePercent: 30,
    });
    expect(r.coveragePercent).toBe(30);
    expect(r.effectiveForeground).toBe('#202020');
  });

  it('高精度覆盖率下的 .5 边界：黑字在一级深灰（#010101）墙上不被 ULP 容差错误提亮', () => {
    // 混合值 = 1 × 剩余比例。回归：固定 1e-9 绝对容差会把真实低于 .5 的值
    // 顶过边界而错误上舍（提亮一档）；ULP 相对容差只吸收浮点误差。
    const wall = { r: 1, g: 1, b: 1 };
    // 50.00000001% → 剩余 0.4999999999 < .5，应舍为 0
    expect(blendChannels({ r: 0, g: 0, b: 0 }, wall, 0.5000000001)).toEqual({ r: 0, g: 0, b: 0 });
    // 49.999999999% → 剩余 0.50000000001 > .5，应上舍为 1
    expect(blendChannels({ r: 0, g: 0, b: 0 }, wall, 0.49999999999)).toEqual({ r: 1, g: 1, b: 1 });
    // 恰 50% → .5 恒向上取 1
    expect(blendChannels({ r: 0, g: 0, b: 0 }, wall, 0.5)).toEqual({ r: 1, g: 1, b: 1 });
    expect(rgbColorToHex(blendChannels({ r: 0, g: 0, b: 0 }, wall, 0.5000000001))).toBe('#000000');
  });

  it('高精度覆盖率经 validateInputs → verifyContrast 链路仍不错误提亮', () => {
    const { errors, coveragePercent } = validateInputs({
      foreground: '#000000',
      background: '#010101',
      fontSize: '16',
      inkMode: 'translucent',
      coverage: '50.00000001',
    });
    expect(errors).toEqual({});
    expect(coveragePercent).toBe(50.00000001);
    const r = verifyContrast({
      foreground: '#000000',
      background: '#010101',
      fontSizePx: 16,
      weight: 'normal',
      coveragePercent,
    });
    expect(r.effectiveForeground).toBe('#000000');
  });

  it('覆盖率 1 时结果与前景逐通道相等（与原不透明算法等价）', () => {
    const fg = { r: 18, g: 52, b: 86 };
    expect(blendChannels(fg, { r: 255, g: 255, b: 255 }, 1)).toEqual(fg);
    expect(blendChannels(fg, { r: 0, g: 0, b: 0 }, 1)).toEqual(fg);
  });
});

describe('verifyContrast：半透明着色进入既有裁决链路', () => {
  it('结果对象同时保留标称前景色、覆盖率与有效前景色', () => {
    const r = verifyContrast({
      foreground: '#000000',
      background: '#FFFFFF',
      fontSizePx: 16,
      weight: 'normal',
      coveragePercent: 50,
    });
    expect(r.foreground).toBe('#000000');
    expect(r.coveragePercent).toBe(50);
    expect(r.effectiveForeground).toBe('#808080');
    // 有效前景 #808080 对白 ≈ 3.949：普通 AA 未通过、大号 AA 通过、大号 AAA 未通过
    expect(r.ratio).toBeCloseTo(3.949, 2);
    expect(r.verdicts).toEqual({
      normalAA: false,
      normalAAA: false,
      largeAA: true,
      largeAAA: false,
    });
  });

  it('覆盖率 100% 时与不透明路径完全等价', () => {
    const opaque = verifyContrast({
      foreground: '#123456',
      background: '#ABCDEF',
      fontSizePx: 20,
      weight: 'bold',
    });
    const full = verifyContrast({
      foreground: '#123456',
      background: '#ABCDEF',
      fontSizePx: 20,
      weight: 'bold',
      coveragePercent: 100,
    });
    expect(full.ratio).toBe(opaque.ratio);
    expect(full.effectiveForeground).toBe('#123456');
    expect(full.verdicts).toEqual(opaque.verdicts);
    expect(full.isLargeText).toBe(opaque.isLargeText);
  });

  it('不传覆盖率（不透明）时有效前景色与标称前景色一致', () => {
    const r = verifyContrast({ foreground: '#1a2B3c', background: '#FFFFFF', fontSizePx: 16, weight: 'normal' });
    expect(r.coveragePercent).toBeNull();
    expect(r.effectiveForeground).toBe('#1a2B3c');
  });

  it('覆盖率越界或非有限数时抛错（调用方须先校验）', () => {
    for (const coveragePercent of [0, -1, 100.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        verifyContrast({ foreground: '#000000', background: '#FFFFFF', fontSizePx: 16, weight: 'normal', coveragePercent }),
      ).toThrow();
    }
  });
});

describe('buildPlainTextSummary：半透明摘要呈现计算依据', () => {
  it('包含着色方式、标称前景色与有效前景色，其余行与不透明一致', () => {
    const r = verifyContrast({
      foreground: '#000000',
      background: '#FFFFFF',
      fontSizePx: 16,
      weight: 'normal',
      coveragePercent: 50,
    });
    expect(buildPlainTextSummary(r)).toBe(
      [
        '着色方式: 半透明（覆盖率 50%）',
        '标称前景色: #000000',
        '有效前景色: #808080',
        '背景色: #FFFFFF',
        '字号: 16px',
        '字重: 普通',
        '文字分类: 普通文字',
        '对比度: 3.95',
        '普通文字 AA: 未通过',
        '普通文字 AAA: 未通过',
        '大号文字 AA: 通过',
        '大号文字 AAA: 未通过',
      ].join('\n'),
    );
  });
});
