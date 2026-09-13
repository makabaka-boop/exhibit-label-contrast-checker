import { crc32, deflateSync } from 'node:zlib';

/**
 * 供 E2E 使用的最小 PNG 编码器（真彩色 + 8 位 alpha，无滤镜、无隔行）。
 * 测试用例直接在内存里合成色块图片，无需提交二进制夹具。
 */
export function makePng(
  width: number,
  height: number,
  paint: (x: number, y: number) => readonly [number, number, number, number],
): Buffer {
  const rowBytes = width * 4 + 1;
  const raw = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * rowBytes] = 0; // filter type 0（无滤波）
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = paint(x, y);
      const offset = y * rowBytes + 1 + x * 4;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
    }
  }

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 位深
  ihdr[9] = 6; // 颜色类型 RGBA
  ihdr[10] = 0; // 压缩方式
  ihdr[11] = 0; // 滤波方式
  ihdr[12] = 0; // 不隔行

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])) >>> 0, 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}
