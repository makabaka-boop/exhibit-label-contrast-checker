/**
 * 行长预检排版领域服务：纯函数，不接触 DOM 与 Canvas。
 * 接收排版测量请求与字符宽度适配器，产出逐行排版结果；
 * 字体如何测量（Canvas 等）完全由适配器决定，领域服务只依赖 measure 接口。
 */

/** 字符宽度适配器：由浏览器层注入，领域服务只依赖此接口。 */
export interface TextWidthAdapter {
  /** 返回文本在当前字体设置下的 CSS 像素宽度。 */
  measure(text: string): number;
}

/** 预检字重：与对比度表单无关，本领域自定义。 */
export type PrecheckFontWeight = 'normal' | 'bold';

/**
 * 排版测量请求：字号与字重已在适配器创建时固化，
 * 请求只携带排版本身需要的约束（文案、可用宽度、行数上限）。
 */
export interface LayoutRequest {
  /** 标题文案，可含显式换行（\n；\r\n 与 \r 同样视为换行）。 */
  text: string;
  /** 版心可用宽度（CSS px），调用方保证为正数。 */
  maxWidthPx: number;
  /** 允许的最大行数，调用方保证为正整数。 */
  maxLines: number;
}

export interface LayoutLine {
  /** 该行实际排下的文本（不含行尾空格；空行保留为空串）。 */
  text: string;
  /** 该行文本的实测宽度（CSS px）。 */
  widthPx: number;
}

export interface LayoutResult {
  lines: LayoutLine[];
  /** 所有行中的最大实测行宽（CSS px）。 */
  longestLineWidthPx: number;
  lineCount: number;
  /** 排版行数是否超过请求的最大行数。 */
  exceedsMaxLines: boolean;
}

/**
 * 单个显式行的贪心排版：
 * 优先在空格处断行（连续空白折叠为一个空格，与 CSS white-space: pre-line 的
 * 空白处理一致）；某个词整体超过可用宽度时，按 Unicode 字符（码点）贪心切分，
 * 单个字符仍超宽时独占一行（行宽超出可用宽度，属不可避免的溢出）。
 */
function layoutParagraph(paragraph: string, maxWidthPx: number, adapter: TextWidthAdapter): string[] {
  const words = paragraph.split(/\s+/).filter((word) => word.length > 0);
  const lines: string[] = [];
  let current = '';
  const pushCurrent = () => {
    if (current !== '') {
      lines.push(current);
      current = '';
    }
  };
  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (adapter.measure(candidate) <= maxWidthPx) {
      current = candidate;
      continue;
    }
    // 当前行排不下这个词：先在词边界（空格处）断行。
    pushCurrent();
    if (adapter.measure(word) <= maxWidthPx) {
      current = word;
      continue;
    }
    // 词本身超过可用宽度：按 Unicode 码点逐字贪心切分。
    let chunk = '';
    for (const char of Array.from(word)) {
      const next = chunk + char;
      if (chunk !== '' && adapter.measure(next) > maxWidthPx) {
        lines.push(chunk);
        chunk = char;
      } else {
        chunk = next;
      }
    }
    current = chunk;
  }
  pushCurrent();
  if (lines.length === 0) {
    // 空段落（显式空行）仍占一行。
    lines.push('');
  }
  return lines;
}

/**
 * 排版主入口：保留显式换行（每个显式行独立排版、互不合并），
 * 逐行实测宽度并汇总最长行宽与行数结论。
 */
export function layoutLines(request: LayoutRequest, adapter: TextWidthAdapter): LayoutResult {
  const paragraphs = request.text.split(/\r\n?|\n/);
  const texts = paragraphs.flatMap((paragraph) =>
    layoutParagraph(paragraph, request.maxWidthPx, adapter),
  );
  const lines: LayoutLine[] = texts.map((text) => ({ text, widthPx: adapter.measure(text) }));
  const longestLineWidthPx = lines.reduce((max, line) => Math.max(max, line.widthPx), 0);
  return {
    lines,
    longestLineWidthPx,
    lineCount: lines.length,
    exceedsMaxLines: lines.length > request.maxLines,
  };
}

/** 预检表单原始草稿（受控输入的字符串原值）。 */
export interface PrecheckDraft {
  title: string;
  maxWidth: string;
  fontSize: string;
  maxLines: string;
}

export interface PrecheckErrors {
  title?: string;
  maxWidth?: string;
  fontSize?: string;
  maxLines?: string;
}

/** 校验通过后的解析结果：文案保留原始输入（含显式换行）。 */
export interface ValidatedPrecheck {
  text: string;
  maxWidthPx: number;
  fontSizePx: number;
  maxLines: number;
}

/** 仅接受普通十进制数字（整数或小数），拒绝 16px、1e3、0x10、Infinity 等写法。 */
export const PRECHECK_NUMBER_PATTERN = /^(?:\d+(?:\.\d+)?|\.\d+)$/;

/** 最大行数只接受正整数写法。 */
export const PRECHECK_INTEGER_PATTERN = /^\d+$/;

/**
 * 草稿校验：空文案、非正宽度、非正字号或无效行数各自给出错误，
 * 调用方据此就地说明并保留最近一次有效记录。
 */
export function validatePrecheckDraft(draft: PrecheckDraft): {
  errors: PrecheckErrors;
  value: ValidatedPrecheck | null;
} {
  const errors: PrecheckErrors = {};

  if (draft.title.trim() === '') {
    errors.title = '标题文案不能为空';
  }

  const widthRaw = draft.maxWidth.trim();
  const maxWidthPx = PRECHECK_NUMBER_PATTERN.test(widthRaw) ? Number(widthRaw) : Number.NaN;
  if (!Number.isFinite(maxWidthPx) || maxWidthPx <= 0) {
    errors.maxWidth = '可用宽度必须是大于 0 的数字（CSS 像素）';
  }

  const sizeRaw = draft.fontSize.trim();
  const fontSizePx = PRECHECK_NUMBER_PATTERN.test(sizeRaw) ? Number(sizeRaw) : Number.NaN;
  if (!Number.isFinite(fontSizePx) || fontSizePx <= 0) {
    errors.fontSize = '字号必须是大于 0 的数字（CSS 像素）';
  }

  const linesRaw = draft.maxLines.trim();
  const maxLines = PRECHECK_INTEGER_PATTERN.test(linesRaw) ? Number(linesRaw) : Number.NaN;
  if (!Number.isInteger(maxLines) || maxLines < 1) {
    errors.maxLines = '最大行数必须是大于 0 的整数';
  }

  if (Object.keys(errors).length > 0) {
    return { errors, value: null };
  }
  return {
    errors,
    value: { text: draft.title, maxWidthPx, fontSizePx, maxLines },
  };
}
