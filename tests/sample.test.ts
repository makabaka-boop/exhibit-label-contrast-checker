import { describe, expect, it } from 'vitest';
import {
  channelToHex,
  mapDisplayPointToImagePixel,
  rgbChannelsToHex,
} from '../src/lib/sample';

describe('channelToHex：0–255 通道转两位大写十六进制', () => {
  it('边界值与常见通道', () => {
    expect(channelToHex(0)).toBe('00');
    expect(channelToHex(10)).toBe('0A');
    expect(channelToHex(15)).toBe('0F');
    expect(channelToHex(16)).toBe('10');
    expect(channelToHex(255)).toBe('FF');
  });

  it('小于 16 的值一律补零，且输出大写', () => {
    for (let c = 0; c < 16; c += 1) {
      expect(channelToHex(c)).toHaveLength(2);
      expect(channelToHex(c)).toBe(c.toString(16).toUpperCase().padStart(2, '0'));
    }
  });

  it('超出 0–255 或非整数一律抛错', () => {
    expect(() => channelToHex(-1)).toThrow();
    expect(() => channelToHex(256)).toThrow();
    expect(() => channelToHex(12.5)).toThrow();
    expect(() => channelToHex(Number.NaN)).toThrow();
  });
});

describe('rgbChannelsToHex：像素通道转不透明六位色值', () => {
  it('拼接为 #RRGGBB，且始终是六位、不带 alpha', () => {
    expect(rgbChannelsToHex(0, 0, 0)).toBe('#000000');
    expect(rgbChannelsToHex(255, 255, 255)).toBe('#FFFFFF');
    expect(rgbChannelsToHex(26, 43, 60)).toBe('#1A2B3C');
    expect(rgbChannelsToHex(10, 11, 12)).toBe('#0A0B0C');
    const hex = rgbChannelsToHex(1, 2, 3);
    expect(hex).toMatch(/^#[0-9A-F]{6}$/);
    expect(hex).toHaveLength(7);
  });
});

describe('mapDisplayPointToImagePixel：缩放坐标换算', () => {
  const size = {
    naturalWidth: 100,
    naturalHeight: 50,
    displayWidth: 200,
    displayHeight: 100,
  };

  it('原始尺寸与显示尺寸一致时恒等映射', () => {
    const same = {
      naturalWidth: 40,
      naturalHeight: 30,
      displayWidth: 40,
      displayHeight: 30,
    };
    expect(mapDisplayPointToImagePixel({ x: 0, y: 0 }, same)).toEqual({ x: 0, y: 0 });
    expect(mapDisplayPointToImagePixel({ x: 39.9, y: 29.9 }, same)).toEqual({ x: 39, y: 29 });
    expect(mapDisplayPointToImagePixel({ x: 25, y: 17 }, same)).toEqual({ x: 25, y: 17 });
  });

  it('按显示→原始比例缩放（含非等比）', () => {
    expect(mapDisplayPointToImagePixel({ x: 0, y: 0 }, size)).toEqual({ x: 0, y: 0 });
    expect(mapDisplayPointToImagePixel({ x: 100, y: 50 }, size)).toEqual({ x: 50, y: 25 });
    expect(mapDisplayPointToImagePixel({ x: 199.9, y: 99.9 }, size)).toEqual({
      x: 99,
      y: 49,
    });
    // 非等比缩放：x、y 分别按各自轴换算
    const nonUniform = {
      naturalWidth: 100,
      naturalHeight: 100,
      displayWidth: 50,
      displayHeight: 25,
    };
    expect(mapDisplayPointToImagePixel({ x: 25, y: 12.5 }, nonUniform)).toEqual({
      x: 50,
      y: 50,
    });
  });

  it('点击恰在右/下边缘（坐标等于显示尺寸）时取最后一个像素', () => {
    expect(mapDisplayPointToImagePixel({ x: 200, y: 100 }, size)).toEqual({ x: 99, y: 49 });
    expect(mapDisplayPointToImagePixel({ x: 200, y: 0 }, size)).toEqual({ x: 99, y: 0 });
    expect(mapDisplayPointToImagePixel({ x: 0, y: 100 }, size)).toEqual({ x: 0, y: 49 });
  });

  it('点击落在边界外（负值或超出显示尺寸）时返回 null', () => {
    expect(mapDisplayPointToImagePixel({ x: -0.1, y: 0 }, size)).toBeNull();
    expect(mapDisplayPointToImagePixel({ x: 0, y: -1 }, size)).toBeNull();
    expect(mapDisplayPointToImagePixel({ x: 200.1, y: 0 }, size)).toBeNull();
    expect(mapDisplayPointToImagePixel({ x: 0, y: 100.1 }, size)).toBeNull();
    expect(mapDisplayPointToImagePixel({ x: Number.NaN, y: 0 }, size)).toBeNull();
    expect(mapDisplayPointToImagePixel({ x: 0, y: Number.NaN }, size)).toBeNull();
  });

  it('尺寸非法（非正数或非有限）时返回 null', () => {
    const points = { x: 1, y: 1 };
    expect(
      mapDisplayPointToImagePixel(points, {
        naturalWidth: 0,
        naturalHeight: 50,
        displayWidth: 200,
        displayHeight: 100,
      }),
    ).toBeNull();
    expect(
      mapDisplayPointToImagePixel(points, {
        naturalWidth: 100,
        naturalHeight: -50,
        displayWidth: 200,
        displayHeight: 100,
      }),
    ).toBeNull();
    expect(
      mapDisplayPointToImagePixel(points, {
        naturalWidth: 100,
        naturalHeight: 50,
        displayWidth: Number.NaN,
        displayHeight: 100,
      }),
    ).toBeNull();
  });
});
