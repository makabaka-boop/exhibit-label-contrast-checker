import { describe, expect, it } from 'vitest';
import {
  averageNeighborhood,
  channelToHex,
  hasKnownImageSignature,
  mapDisplayPointToImagePixel,
  rgbChannelsToHex,
  type PixelData,
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

  it('右/下边缘线（坐标等于显示尺寸）已不在图片区域，返回 null', () => {
    // 画布的装饰边框恰好落在边缘线上：边框点击不得采样末列/末行像素
    expect(mapDisplayPointToImagePixel({ x: 200, y: 100 }, size)).toBeNull();
    expect(mapDisplayPointToImagePixel({ x: 200, y: 0 }, size)).toBeNull();
    expect(mapDisplayPointToImagePixel({ x: 0, y: 100 }, size)).toBeNull();
    // 边缘线内侧紧邻的最后一个内容像素仍可正常采样
    expect(mapDisplayPointToImagePixel({ x: 199.5, y: 99.5 }, size)).toEqual({ x: 99, y: 49 });
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

describe('averageNeighborhood：中心周围 3×3 区域平均', () => {
  /** 按 (x, y) → RGBA 的上色函数铺出整块 RGBA 像素数据（每像素 4 分量，按行排列）。 */
  function buildPixels(
    width: number,
    height: number,
    paint: (x: number, y: number) => readonly [number, number, number, number],
  ): PixelData {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const [r, g, b, a] = paint(x, y);
        const offset = (y * width + x) * 4;
        data[offset] = r;
        data[offset + 1] = g;
        data[offset + 2] = b;
        data[offset + 3] = a;
      }
    }
    return data;
  }

  const size = { naturalWidth: 5, naturalHeight: 5 };

  it('中心区域：完整计入 9 个像素，各通道算术平均并四舍五入', () => {
    // 中心 (2,2) 的 3×3 邻域：除中心为 (10,10,0) 外，其余 8 像素均为 (9,8,1)
    const pixels = buildPixels(5, 5, (x, y) =>
      x === 2 && y === 2 ? [10, 10, 0, 255] : [9, 8, 1, 255],
    );
    // R: (9*8+10)/9 = 9.111… → 9；G: (8*8+10)/9 = 8.222… → 8；B: (1*8+0)/9 = 0.888… → 1
    const result = averageNeighborhood(pixels, size, { x: 2, y: 2 });
    expect(result).not.toBeNull();
    expect(result!.count).toBe(9);
    expect(result!.hex).toBe('#090801');
  });

  it('中心区域：忽略 alpha，恒色区域平均后仍是该六位色值', () => {
    // 邻域内 alpha 五花八门，平均色只看 R/G/B
    const pixels = buildPixels(5, 5, (x, y) => [0x12, 0x34, 0x56, ((x * 5 + y) * 7) % 256]);
    const result = averageNeighborhood(pixels, size, { x: 2, y: 2 });
    expect(result!.count).toBe(9);
    expect(result!.hex).toBe('#123456');
  });

  it('边缘裁剪：左上角 (0,0) 只计范围内 4 个像素，不越界读取', () => {
    // 2×2 范围内：三个 (10,20,30)、一个 (20,30,40)
    const pixels = buildPixels(5, 5, (x, y) =>
      x <= 1 && y <= 1 && !(x === 1 && y === 1)
        ? [10, 20, 30, 255]
        : x === 1 && y === 1
          ? [20, 30, 40, 255]
          : [200, 200, 200, 255],
    );
    const result = averageNeighborhood(pixels, size, { x: 0, y: 0 });
    expect(result!.count).toBe(4);
    // R: (10*3+20)/4 = 12.5 → 13；G: 22.5 → 23；B: 32.5 → 33
    expect(result!.hex).toBe('#0D1721');
  });

  it('边缘裁剪：贴边但不在角上时计入 6 个像素；右下角同理', () => {
    // 顶边中心 (2,0)：两行 × 三列 = 6 个像素，上行两行值为 0 / 60
    const pixels = buildPixels(5, 5, (_x, y) => (y === 0 ? [0, 0, 0, 255] : [60, 60, 60, 255]));
    const top = averageNeighborhood(pixels, size, { x: 2, y: 0 });
    expect(top!.count).toBe(6);
    // 上排 3 个 0、下排 3 个 60 → 30
    expect(top!.hex).toBe('#1E1E1E');

    const bottomRight = averageNeighborhood(pixels, size, { x: 4, y: 4 });
    expect(bottomRight!.count).toBe(4);
    // 邻域两行（y=3、4）全是 60 → 60
    expect(bottomRight!.hex).toBe('#3C3C3C');
  });

  it('通道舍入：半值一律进位（四舍五入），各通道独立舍入', () => {
    // 构造 2×2 邻域（左上角），两像素两通道凑出 .5
    const pixels = buildPixels(2, 2, (x, y) =>
      x === 0 && y === 0 ? [10, 21, 30, 255] : [11, 22, 31, 255],
    );
    const result = averageNeighborhood(pixels, { naturalWidth: 2, naturalHeight: 2 }, { x: 0, y: 0 });
    expect(result!.count).toBe(4);
    // (10+11+11+11)/4 = 10.75 → 11；G: (21+22*3)/4 = 21.75 → 22；B: (30+31*3)/4 = 30.75 → 31
    expect(result!.hex).toBe('#0B161F');

    // 真正的 .5：两像素邻域 [10,10] → 5、[1,1] → 1 时另一通道 [0,1] → 0.5 → 1
    const half = buildPixels(2, 1, (x) => (x === 0 ? [10, 0, 254, 255] : [11, 1, 255, 255]));
    const halfResult = averageNeighborhood(half, { naturalWidth: 2, naturalHeight: 1 }, { x: 0, y: 0 });
    expect(halfResult!.count).toBe(2);
    expect(halfResult!.hex).toBe('#0B01FF'); // R 10.5 → 11，G 0.5 → 1，B 254.5 → 255
  });

  it('有效像素为空或参数非法时返回 null（由调用方提示且不改值）', () => {
    // 空缓冲 + 合法中心：邻域内没有任何完整像素
    expect(averageNeighborhood([], size, { x: 2, y: 2 })).toBeNull();
    expect(averageNeighborhood(new Uint8ClampedArray(0), size, { x: 0, y: 0 })).toBeNull();
    // 缓冲长度不足以容纳中心像素
    expect(averageNeighborhood([0, 0, 0, 0], size, { x: 2, y: 2 })).toBeNull();
    // 中心越界 / 非整数
    expect(averageNeighborhood(buildPixels(5, 5, () => [1, 2, 3, 255]), size, { x: -1, y: 0 })).toBeNull();
    expect(averageNeighborhood(buildPixels(5, 5, () => [1, 2, 3, 255]), size, { x: 5, y: 0 })).toBeNull();
    expect(averageNeighborhood(buildPixels(5, 5, () => [1, 2, 3, 255]), size, { x: 1.5, y: 0 })).toBeNull();
    // 尺寸非法
    expect(
      averageNeighborhood(buildPixels(5, 5, () => [1, 2, 3, 255]), { naturalWidth: 0, naturalHeight: 5 }, { x: 0, y: 0 }),
    ).toBeNull();
    expect(
      averageNeighborhood(buildPixels(5, 5, () => [1, 2, 3, 255]), { naturalWidth: -5, naturalHeight: 5 }, { x: 0, y: 0 }),
    ).toBeNull();
  });
});

describe('hasKnownImageSignature：文件头魔数识别', () => {
  it('识别常见图片格式', () => {
    // PNG
    expect(
      hasKnownImageSignature([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ).toBe(true);
    // JPEG
    expect(hasKnownImageSignature([0xff, 0xd8, 0xff, 0xe0, 0x00])).toBe(true);
    // GIF89a
    expect(hasKnownImageSignature([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])).toBe(true);
    // BMP
    expect(hasKnownImageSignature([0x42, 0x4d, 0x36, 0x00])).toBe(true);
    // WebP：RIFF....WEBP
    expect(
      hasKnownImageSignature([
        0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
      ]),
    ).toBe(true);
    // TIFF（小端 / 大端）
    expect(hasKnownImageSignature([0x49, 0x49, 0x2a, 0x00])).toBe(true);
    expect(hasKnownImageSignature([0x4d, 0x4d, 0x00, 0x2a])).toBe(true);
    // ICO
    expect(hasKnownImageSignature([0x00, 0x00, 0x01, 0x00])).toBe(true);
    // AVIF：....ftypavif
    expect(
      hasKnownImageSignature([
        0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66,
      ]),
    ).toBe(true);
  });

  it('纯文本、空内容与截断的头部都不是图片', () => {
    expect(hasKnownImageSignature(new TextEncoder().encode('not an image'))).toBe(false);
    expect(hasKnownImageSignature(new TextEncoder().encode('{"json": true}'))).toBe(false);
    expect(hasKnownImageSignature([])).toBe(false);
    // 只有 PNG 签名的前 3 个字节，不算 PNG
    expect(hasKnownImageSignature([0x89, 0x50, 0x4e])).toBe(false);
    // RIFF 但非 WEBP（如 WAV 音频）
    expect(
      hasKnownImageSignature([
        0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
      ]),
    ).toBe(false);
  });
});
