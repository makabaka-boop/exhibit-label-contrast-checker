/**
 * 本地图片取色的领域逻辑（纯函数，无 DOM 依赖）。
 * 画布层只负责拿到像素通道与坐标换算所需的尺寸；这里集中负责
 * “像素通道 → 不透明六位色值”以及“缩放后点击坐标 → 原始像素点”。
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
 * 显示尺寸由原始尺寸等比缩放而来，故按比例换算并向最近整数取整；
 * 点击点落在画布边界外（含 NaN / 负数）时返回 null，由调用方提示且不覆盖输入。
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
    x > displayWidth ||
    y > displayHeight
  ) {
    return null;
  }
  // 点击点恰在右/下边缘（x === displayWidth）时比例为 1，换算后夹取到最后一个像素。
  const pixelX = Math.min(naturalWidth - 1, Math.floor((x / displayWidth) * naturalWidth));
  const pixelY = Math.min(naturalHeight - 1, Math.floor((y / displayHeight) * naturalHeight));
  return { x: pixelX, y: pixelY };
}
