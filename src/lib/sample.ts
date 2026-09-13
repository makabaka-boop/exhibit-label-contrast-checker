/**
 * 本地图片取色的领域逻辑（纯函数，无 DOM 依赖）。
 * 画布层只负责拿到像素通道与坐标换算所需的尺寸；这里集中负责
 * “像素通道 → 不透明六位色值”、“缩放后点击坐标 → 原始像素点”，
 * 以及文件未携带类型信息时“文件头魔数 → 是否为常见图片”的兜底识别。
 */

/** 单个 0–255 通道转两位大写十六进制（10、15 等小于 16 的值补零）。 */
export function channelToHex(channel: number): string {
  if (!Number.isInteger(channel) || channel < 0 || channel > 255) {
    throw new Error('色通道必须是 0–255 的整数');
  }
  return channel.toString(16).toUpperCase().padStart(2, '0');
}

/**
 * 像素的 R/G/B 通道转 #RRGGBB 不透明六位色值。
 * 本地图片可能自带 alpha 通道，但采样结果一律按不透明处理，不生成八位写法。
 */
export function rgbChannelsToHex(r: number, g: number, b: number): string {
  return `#${channelToHex(r)}${channelToHex(g)}${channelToHex(b)}`;
}

export interface ImageSize {
  /** 图片原始像素尺寸（getImageData 所用坐标系）。 */
  naturalWidth: number;
  naturalHeight: number;
  /** 画布缩放后的 CSS 显示尺寸（点击事件所用坐标系）。 */
  displayWidth: number;
  displayHeight: number;
}

export interface DisplayPoint {
  x: number;
  y: number;
}

export interface ImagePixel {
  x: number;
  y: number;
}

/**
 * 把缩放后画布上的点击坐标换算成图片原始尺寸下的采样点。
 * 显示尺寸由原始尺寸等比缩放而来，故按比例换算并向最近整数取整。
 * 有效点击范围为左闭右开的 [0, displayWidth) × [0, displayHeight)：
 * 右/下边缘线本身已不属于图片内容（画布的装饰边框正落在那里），
 * 落在边界外或边缘线上（含 NaN / 负数）时返回 null，由调用方提示且不覆盖输入。
 */
export function mapDisplayPointToImagePixel(
  point: DisplayPoint,
  size: ImageSize,
): ImagePixel | null {
  const { naturalWidth, naturalHeight, displayWidth, displayHeight } = size;
  if (
    !Number.isFinite(naturalWidth) ||
    !Number.isFinite(naturalHeight) ||
    !Number.isFinite(displayWidth) ||
    !Number.isFinite(displayHeight) ||
    naturalWidth <= 0 ||
    naturalHeight <= 0 ||
    displayWidth <= 0 ||
    displayHeight <= 0
  ) {
    return null;
  }
  const { x, y } = point;
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x < 0 ||
    y < 0 ||
    x >= displayWidth ||
    y >= displayHeight
  ) {
    return null;
  }
  // x < displayWidth 保证比例小于 1；夹取仅防御浮点舍入贴到 1 的极端情形。
  const pixelX = Math.min(naturalWidth - 1, Math.floor((x / displayWidth) * naturalWidth));
  const pixelY = Math.min(naturalHeight - 1, Math.floor((y / displayHeight) * naturalHeight));
  return { x: pixelX, y: pixelY };
}

/**
 * 按文件头魔数判断字节序列是否为常见图片格式
 * （PNG / JPEG / GIF / BMP / WebP / TIFF / ICO / AVIF）。
 * 所选文件未携带 MIME 类型时据此兜底识别：纯文本等文件应报“不是图片”，
 * 而不是留到解码阶段才误报“解码失败”。
 */
export function hasKnownImageSignature(bytes: ArrayLike<number>): boolean {
  // 字节序列短于任一签名时，越界读取得到 undefined，比较自然不成立。
  const matches = (signature: readonly number[], offset = 0): boolean =>
    signature.every((byte, index) => bytes[offset + index] === byte);
  return (
    matches([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) || // PNG
    matches([0xff, 0xd8, 0xff]) || // JPEG
    matches([0x47, 0x49, 0x46, 0x38]) || // GIF87a / GIF89a
    matches([0x42, 0x4d]) || // BMP
    (matches([0x52, 0x49, 0x46, 0x46]) && matches([0x57, 0x45, 0x42, 0x50], 8)) || // WebP：RIFF....WEBP
    matches([0x49, 0x49, 0x2a, 0x00]) || // TIFF（小端）
    matches([0x4d, 0x4d, 0x00, 0x2a]) || // TIFF（大端）
    matches([0x00, 0x00, 0x01, 0x00]) || // ICO
    (matches([0x66, 0x74, 0x79, 0x70], 4) && matches([0x61, 0x76, 0x69], 8)) // AVIF：....ftypavi*
  );
}
