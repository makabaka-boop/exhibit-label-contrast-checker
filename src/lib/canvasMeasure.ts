import type { PrecheckFontWeight, TextWidthAdapter } from './linebreak';

/**
 * 预检测量用的字体栈：与预检结果区逐行预览的 font-family 保持一致，
 * 使 Canvas 测量值与页面实际渲染一致。
 */
export const PRECHECK_FONT_FAMILY =
  "'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', system-ui, -apple-system, sans-serif";

/**
 * 浏览器适配层：只负责调用 Canvas 测量，把结果交给排版领域服务。
 * 返回 null 表示 Canvas 不可用（调用方据此展示测量失败、不写入存储）。
 */
export function createCanvasTextWidthAdapter(
  fontSizePx: number,
  weight: PrecheckFontWeight,
): TextWidthAdapter | null {
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) {
      return null;
    }
    context.font = `${weight} ${fontSizePx}px ${PRECHECK_FONT_FAMILY}`;
    return {
      measure: (text) => context.measureText(text).width,
    };
  } catch {
    return null;
  }
}
