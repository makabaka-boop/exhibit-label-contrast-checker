import { describe, expect, it } from 'vitest';
import {
  layoutLines,
  validatePrecheckDraft,
  type TextWidthAdapter,
} from '../src/lib/linebreak';

/**
 * 等宽假适配器：每个 Unicode 码点固定宽度（默认 10px），
 * 空格同宽；用码点计数，可暴露按 UTF-16 码元切分的错误实现。
 */
function fixedWidth(perChar = 10): TextWidthAdapter {
  return { measure: (text) => Array.from(text).length * perChar };
}

/** 按字符查表的假适配器：验证排版以实测宽度而非字符个数为准。 */
function widthByChar(widths: Record<string, number>): TextWidthAdapter {
  return {
    measure: (text) =>
      Array.from(text).reduce((sum, char) => sum + (widths[char] ?? 10), 0),
  };
}

describe('断行契约：优先在空格处断行', () => {
  it('贪心填充，排不下时在词边界断行', () => {
    // "aa bb" 恰 50px 放下，再加 " cc" 超宽 → 第二行只有 "cc"
    const result = layoutLines({ text: 'aa bb cc', maxWidthPx: 50, maxLines: 10 }, fixedWidth());
    expect(result.lines.map((line) => line.text)).toEqual(['aa bb', 'cc']);
    expect(result.longestLineWidthPx).toBe(50);
  });

  it('行宽恰等于可用宽度时仍可放下（边界含等于）', () => {
    const result = layoutLines({ text: 'aa bb cc', maxWidthPx: 80, maxLines: 10 }, fixedWidth());
    expect(result.lines.map((line) => line.text)).toEqual(['aa bb cc']);
    expect(result.lineCount).toBe(1);
    expect(result.longestLineWidthPx).toBe(80);
  });

  it('当前行排不下的词若独自成行能放下，则不断词、整词移到下一行', () => {
    const result = layoutLines({ text: 'aaaa bb', maxWidthPx: 50, maxLines: 10 }, fixedWidth());
    expect(result.lines.map((line) => line.text)).toEqual(['aaaa', 'bb']);
  });

  it('连续空白折叠为一个空格，首尾空白不计入行', () => {
    const result = layoutLines({ text: '  aa   bb  ', maxWidthPx: 100, maxLines: 10 }, fixedWidth());
    expect(result.lines.map((line) => line.text)).toEqual(['aa bb']);
    expect(result.longestLineWidthPx).toBe(50);
  });

  it('制表符等其他空白同样作为断行机会', () => {
    const result = layoutLines({ text: 'aa\tbb', maxWidthPx: 100, maxLines: 10 }, fixedWidth());
    expect(result.lines.map((line) => line.text)).toEqual(['aa bb']);
  });

  it('排版依据实测宽度而非字符个数', () => {
    // a 宽 10、b 宽 20、空格宽 10："ab ab" = 30+10+30 = 70 > 60 → 断为两行
    const adapter = widthByChar({ a: 10, b: 20, ' ': 10 });
    const result = layoutLines({ text: 'ab ab', maxWidthPx: 60, maxLines: 10 }, adapter);
    expect(result.lines.map((line) => line.text)).toEqual(['ab', 'ab']);
    expect(result.longestLineWidthPx).toBe(30);
  });
});

describe('显式换行：保留且互不合并', () => {
  it('显式换行处强制断行，即使合并后能放下', () => {
    const result = layoutLines({ text: 'aa\nbb', maxWidthPx: 1000, maxLines: 10 }, fixedWidth());
    expect(result.lines.map((line) => line.text)).toEqual(['aa', 'bb']);
    expect(result.lineCount).toBe(2);
  });

  it('连续换行产生空行，空行宽度为 0', () => {
    const result = layoutLines({ text: 'aa\n\nbb', maxWidthPx: 1000, maxLines: 10 }, fixedWidth());
    expect(result.lines).toEqual([
      { text: 'aa', widthPx: 20 },
      { text: '', widthPx: 0 },
      { text: 'bb', widthPx: 20 },
    ]);
  });

  it('末尾换行留下一个空行', () => {
    const result = layoutLines({ text: 'aa\n', maxWidthPx: 1000, maxLines: 10 }, fixedWidth());
    expect(result.lines.map((line) => line.text)).toEqual(['aa', '']);
  });

  it('显式行内部仍按空格断行', () => {
    const result = layoutLines(
      { text: 'aa bb\ncc dd', maxWidthPx: 50, maxLines: 10 },
      fixedWidth(),
    );
    expect(result.lines.map((line) => line.text)).toEqual(['aa bb', 'cc dd']);
  });

  it('\\r\\n 与 \\r 同样视为显式换行', () => {
    const result = layoutLines(
      { text: 'aa\r\nbb\rcc', maxWidthPx: 1000, maxLines: 10 },
      fixedWidth(),
    );
    expect(result.lines.map((line) => line.text)).toEqual(['aa', 'bb', 'cc']);
  });
});

describe('超长连续文本：按 Unicode 字符切分', () => {
  it('无空格中文标题按字符贪心切分', () => {
    // 每字 20px，可用 50px → 每行两字
    const result = layoutLines(
      { text: '博物馆奇妙夜', maxWidthPx: 50, maxLines: 10 },
      fixedWidth(20),
    );
    expect(result.lines.map((line) => line.text)).toEqual(['博物', '馆奇', '妙夜']);
    expect(result.longestLineWidthPx).toBe(40);
  });

  it('emoji 按码点切分，代理对不被拆散', () => {
    // 每个 emoji 10px，可用 15px → 每行一个完整 emoji；
    // 若按 UTF-16 码元切分会得到 6 行残缺代理项
    const result = layoutLines({ text: '😀😀😀', maxWidthPx: 15, maxLines: 10 }, fixedWidth());
    expect(result.lines.map((line) => line.text)).toEqual(['😀', '😀', '😀']);
    expect(result.lineCount).toBe(3);
  });

  it('长词切分后，后续词继续从剩余行接着排', () => {
    // "bbbbbb" 60px 超过 30px 版心 → 切成两段；"cc" 接在最后一段之后
    const result = layoutLines(
      { text: 'aa bbbbbb cc', maxWidthPx: 30, maxLines: 10 },
      fixedWidth(),
    );
    expect(result.lines.map((line) => line.text)).toEqual(['aa', 'bbb', 'bbb', 'cc']);
  });

  it('单个字符已超宽时独占一行（不可避免的溢出），排版继续', () => {
    const result = layoutLines({ text: '😀😀', maxWidthPx: 5, maxLines: 10 }, fixedWidth());
    expect(result.lines.map((line) => line.text)).toEqual(['😀', '😀']);
    expect(result.longestLineWidthPx).toBe(10);
  });
});

describe('适配器测量报错：领域服务不吞错、向上抛出', () => {
  it('measure 抛错时 layoutLines 原样向上抛出（由调用方决定如何提示）', () => {
    const failing: TextWidthAdapter = {
      measure: () => {
        throw new Error('measure failed');
      },
    };
    expect(() =>
      layoutLines({ text: 'aa bb', maxWidthPx: 50, maxLines: 2 }, failing),
    ).toThrow('measure failed');
  });

  it('排版中途报错同样向上抛出，不产出半截结果', () => {
    // 前两次测量正常，第三次开始抛错（模拟测量中途画布失效）
    let calls = 0;
    const flaky: TextWidthAdapter = {
      measure: (text) => {
        calls += 1;
        if (calls > 2) {
          throw new Error('context lost');
        }
        return Array.from(text).length * 10;
      },
    };
    expect(() =>
      layoutLines({ text: 'aa bb cc dd', maxWidthPx: 50, maxLines: 5 }, flaky),
    ).toThrow('context lost');
  });
});

describe('行数结论与最长行宽', () => {
  it('行数超过上限时 exceedsMaxLines 为 true，等于上限不算超', () => {
    const adapter = fixedWidth();
    const three = layoutLines({ text: 'aa bb cc', maxWidthPx: 50, maxLines: 1 }, adapter);
    expect(three.lineCount).toBe(2);
    expect(three.exceedsMaxLines).toBe(true);

    const exact = layoutLines({ text: 'aa bb cc', maxWidthPx: 50, maxLines: 2 }, adapter);
    expect(exact.lineCount).toBe(2);
    expect(exact.exceedsMaxLines).toBe(false);
  });

  it('最长行宽取各行实测宽度的最大值', () => {
    const result = layoutLines({ text: 'aaaa bb c', maxWidthPx: 50, maxLines: 10 }, fixedWidth());
    expect(result.lines.map((line) => line.text)).toEqual(['aaaa', 'bb c']);
    expect(result.longestLineWidthPx).toBe(40);
  });

  it('空文案排出一行空行（表单层会拦截空文案，领域层仍给出确定结果）', () => {
    const result = layoutLines({ text: '', maxWidthPx: 100, maxLines: 1 }, fixedWidth());
    expect(result.lines).toEqual([{ text: '', widthPx: 0 }]);
    expect(result.lineCount).toBe(1);
    expect(result.longestLineWidthPx).toBe(0);
    expect(result.exceedsMaxLines).toBe(false);
  });
});

describe('validatePrecheckDraft：空文案、非正宽度、非正字号、无效行数', () => {
  const valid = { title: '展签标题', maxWidth: '240', fontSize: '16', maxLines: '2' };

  it('合法草稿解析出排版请求，文案保留原始输入（含显式换行）', () => {
    const { errors, value } = validatePrecheckDraft({
      ...valid,
      title: '第一行\n第二行',
    });
    expect(errors).toEqual({});
    expect(value).toEqual({ text: '第一行\n第二行', maxWidthPx: 240, fontSizePx: 16, maxLines: 2 });
  });

  it('允许首尾带空格的数值写法与小数字号', () => {
    const { errors, value } = validatePrecheckDraft({
      ...valid,
      maxWidth: ' 240.5 ',
      fontSize: '18.5',
    });
    expect(errors).toEqual({});
    expect(value).toMatchObject({ maxWidthPx: 240.5, fontSizePx: 18.5 });
  });

  it('空文案或纯空白文案报错', () => {
    for (const title of ['', '   ', '\n\t ']) {
      const { errors, value } = validatePrecheckDraft({ ...valid, title });
      expect(errors.title, JSON.stringify(title)).toBeTruthy();
      expect(value).toBeNull();
    }
  });

  it('非正宽度、非数字宽度报错', () => {
    for (const maxWidth of ['0', '-5', '0.0', 'abc', '12px', '1e3', '', 'Infinity']) {
      const { errors, value } = validatePrecheckDraft({ ...valid, maxWidth });
      expect(errors.maxWidth, JSON.stringify(maxWidth)).toBeTruthy();
      expect(value).toBeNull();
    }
  });

  it('非正字号、非数字字号报错', () => {
    for (const fontSize of ['0', '-3', 'abc', '16px', '', 'NaN']) {
      const { errors, value } = validatePrecheckDraft({ ...valid, fontSize });
      expect(errors.fontSize, JSON.stringify(fontSize)).toBeTruthy();
      expect(value).toBeNull();
    }
  });

  it('无效行数报错：零、负数、小数、非数字', () => {
    for (const maxLines of ['0', '-1', '1.5', '2.0', 'abc', '', '1e3']) {
      const { errors, value } = validatePrecheckDraft({ ...valid, maxLines });
      expect(errors.maxLines, JSON.stringify(maxLines)).toBeTruthy();
      expect(value).toBeNull();
    }
  });

  it('各字段错误互不影响，同时报出', () => {
    const { errors, value } = validatePrecheckDraft({
      title: '',
      maxWidth: '0',
      fontSize: '-1',
      maxLines: 'x',
    });
    expect(errors.title).toBeTruthy();
    expect(errors.maxWidth).toBeTruthy();
    expect(errors.fontSize).toBeTruthy();
    expect(errors.maxLines).toBeTruthy();
    expect(value).toBeNull();
  });
});
