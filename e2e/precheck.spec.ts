import { expect, test, type Page } from '@playwright/test';
import { PRECHECK_FONT_FAMILY } from '../src/lib/canvasMeasure';
import { PRECHECK_STORAGE_KEY } from '../src/lib/precheckStorage';

/** 用与应用完全相同的字体串在页面里实测文本宽度（Canvas），与字体环境无关。 */
async function measureText(
  page: Page,
  text: string,
  fontSizePx: number,
  weight: 'normal' | 'bold',
): Promise<number> {
  return page.evaluate(
    ([t, size, w, family]) => {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d')!;
      context.font = `${w} ${size}px ${family}`;
      return context.measureText(t).width;
    },
    [text, fontSizePx, weight, PRECHECK_FONT_FAMILY] as const,
  );
}

async function fillPrecheckForm(
  page: Page,
  draft: { title: string; maxWidth: string; fontSize: string; maxLines: string },
) {
  await page.getByTestId('precheck-title').fill(draft.title);
  await page.getByTestId('precheck-max-width').fill(draft.maxWidth);
  await page.getByTestId('precheck-font-size').fill(draft.fontSize);
  await page.getByTestId('precheck-max-lines').fill(draft.maxLines);
}

/** 提交一份合法草稿并确认结论出现；可用宽度取整串实测宽度减 1，保证 "aaaa bbbb" 必断为两行。 */
async function runValidPrecheck(page: Page): Promise<{ maxWidth: string }> {
  const fullWidth = await measureText(page, 'aaaa bbbb', 20, 'normal');
  const maxWidth = String(fullWidth - 1);
  await fillPrecheckForm(page, {
    title: 'aaaa bbbb',
    maxWidth,
    fontSize: '20',
    maxLines: '2',
  });
  await page.getByTestId('precheck-submit').click();
  await expect(page.getByTestId('precheck-result')).toBeVisible();
  return { maxWidth };
}

test.describe('行长预检工作台', () => {
  test('从对比度核验台可进入预检工作台，并可返回', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: '前往独立的行长预检工作台 →' }).click();
    await expect(page).toHaveURL(/\/precheck\.html$/);
    await expect(page.getByRole('heading', { name: '行长预检工作台' })).toBeVisible();

    await page.getByRole('link', { name: '返回对比度核验台' }).click();
    await expect(page.getByRole('heading', { name: '博物馆展签对比度核验台' })).toBeVisible();
  });

  test('完成预检：逐行排版、最长行宽与行数结论，记录写入存储', async ({ page }) => {
    await page.goto('/precheck.html');

    // 初始：待测 + 暂无有效记录
    await expect(page.getByTestId('precheck-pending')).toBeVisible();
    await expect(page.getByTestId('record-empty')).toBeVisible();
    await expect(page.getByTestId('precheck-weight-normal')).toBeChecked();

    const fullWidth = await measureText(page, 'aaaa bbbb', 20, 'normal');
    const maxWidth = fullWidth - 1;
    await fillPrecheckForm(page, {
      title: 'aaaa bbbb',
      maxWidth: String(maxWidth),
      fontSize: '20',
      maxLines: '2',
    });
    await page.getByTestId('precheck-submit').click();

    // 整串差 1px 放不下 → 在空格处断为两行
    await expect(page.getByTestId('precheck-line-count')).toHaveText('2');
    await expect(page.getByTestId('precheck-line-0')).toHaveText('aaaa');
    await expect(page.getByTestId('precheck-line-1')).toHaveText('bbbb');

    // 逐行实测宽度与最长行宽（同一 Canvas 测量口径，可逐字复算）
    const widthA = await measureText(page, 'aaaa', 20, 'normal');
    const widthB = await measureText(page, 'bbbb', 20, 'normal');
    await expect(page.getByTestId('precheck-line-width-0')).toHaveText(`${widthA.toFixed(2)} px`);
    await expect(page.getByTestId('precheck-line-width-1')).toHaveText(`${widthB.toFixed(2)} px`);
    await expect(page.getByTestId('precheck-longest-width')).toHaveText(
      `${Math.max(widthA, widthB).toFixed(2)} px`,
    );

    // 行数结论与记录区
    await expect(page.getByTestId('precheck-verdict')).toContainText('未超出行数');
    await expect(page.getByTestId('record-card')).toBeVisible();
    await expect(page.getByTestId('record-title')).toHaveText('aaaa bbbb');
    await expect(page.getByTestId('record-verdict')).toHaveText('未超出行数');
    await expect(page.getByTestId('record-lines')).toHaveText('2 / 2');

    // 有效记录已写入 localStorage
    const stored = await page.evaluate((key) => localStorage.getItem(key), PRECHECK_STORAGE_KEY);
    expect(stored).not.toBeNull();
    const record = JSON.parse(stored!);
    expect(record.draft.title).toBe('aaaa bbbb');
    expect(record.result.lineCount).toBe(2);

    // 收紧行数上限：编辑后旧结论回到待测，重新预检给出超出行数结论
    await page.getByTestId('precheck-max-lines').fill('1');
    await expect(page.getByTestId('precheck-pending')).toBeVisible();
    await page.getByTestId('precheck-submit').click();
    await expect(page.getByTestId('precheck-verdict')).toContainText('超出行数');
    await expect(page.getByTestId('precheck-verdict')).toContainText('共 2 行，超过 1 行上限');
    await expect(page.getByTestId('record-verdict')).toHaveText('超出行数');
  });

  test('任一输入变化都会让旧结论回到待测状态', async ({ page }) => {
    await page.goto('/precheck.html');
    await runValidPrecheck(page);

    // 修改文案 → 待测；最近一次有效记录不受影响
    await page.getByTestId('precheck-title').fill('aaaa bbbb cccc');
    await expect(page.getByTestId('precheck-pending')).toBeVisible();
    await expect(page.getByTestId('precheck-result')).toHaveCount(0);
    await expect(page.getByTestId('record-card')).toBeVisible();
    await expect(page.getByTestId('record-title')).toHaveText('aaaa bbbb');

    // 重新预检恢复结论，再改可用宽度 → 再次待测
    await page.getByTestId('precheck-submit').click();
    await expect(page.getByTestId('precheck-result')).toBeVisible();
    await page.getByTestId('precheck-max-width').fill('500');
    await expect(page.getByTestId('precheck-pending')).toBeVisible();

    // 字重切换同样使结论失效
    await page.getByTestId('precheck-submit').click();
    await expect(page.getByTestId('precheck-result')).toBeVisible();
    await page.getByTestId('precheck-weight-bold').check();
    await expect(page.getByTestId('precheck-pending')).toBeVisible();
  });

  test('非法提交就地说明并保留最近一次有效记录', async ({ page }) => {
    await page.goto('/precheck.html');
    const { maxWidth } = await runValidPrecheck(page);

    // 全部字段改为非法值后提交
    await fillPrecheckForm(page, { title: '', maxWidth: '0', fontSize: '-3', maxLines: '1.5' });
    await page.getByTestId('precheck-submit').click();

    // 四个字段就地报错
    await expect(page.getByTestId('precheck-error-title')).toBeVisible();
    await expect(page.getByTestId('precheck-error-max-width')).toBeVisible();
    await expect(page.getByTestId('precheck-error-font-size')).toBeVisible();
    await expect(page.getByTestId('precheck-error-max-lines')).toBeVisible();

    // 结论区回到待测，最近一次有效记录原样保留
    await expect(page.getByTestId('precheck-pending')).toBeVisible();
    await expect(page.getByTestId('record-card')).toBeVisible();
    await expect(page.getByTestId('record-title')).toHaveText('aaaa bbbb');
    await expect(page.getByTestId('record-verdict')).toHaveText('未超出行数');
    const stored = await page.evaluate((key) => localStorage.getItem(key), PRECHECK_STORAGE_KEY);
    expect(JSON.parse(stored!).draft.title).toBe('aaaa bbbb');

    // 修正为合法值后可继续预检，错误随之撤下
    await fillPrecheckForm(page, {
      title: 'aaaa bbbb',
      maxWidth,
      fontSize: '20',
      maxLines: '2',
    });
    await page.getByTestId('precheck-submit').click();
    await expect(page.getByTestId('precheck-error-title')).toHaveCount(0);
    await expect(page.getByTestId('precheck-result')).toBeVisible();
    await expect(page.getByTestId('precheck-line-count')).toHaveText('2');
  });

  test('刷新后恢复最近一次有效记录，可继续修改', async ({ page }) => {
    await page.goto('/precheck.html');
    const fullWidth = await measureText(page, 'aaaa bbbb', 18, 'bold');
    const maxWidth = String(fullWidth - 1);
    await fillPrecheckForm(page, {
      title: 'aaaa bbbb',
      maxWidth,
      fontSize: '18',
      maxLines: '3',
    });
    await page.getByTestId('precheck-weight-bold').check();
    await page.getByTestId('precheck-submit').click();
    await expect(page.getByTestId('precheck-line-count')).toHaveText('2');

    await page.reload();

    // 草稿、结论与记录全部恢复
    await expect(page.getByTestId('precheck-title')).toHaveValue('aaaa bbbb');
    await expect(page.getByTestId('precheck-max-width')).toHaveValue(maxWidth);
    await expect(page.getByTestId('precheck-font-size')).toHaveValue('18');
    await expect(page.getByTestId('precheck-max-lines')).toHaveValue('3');
    await expect(page.getByTestId('precheck-weight-bold')).toBeChecked();
    await expect(page.getByTestId('precheck-result')).toBeVisible();
    await expect(page.getByTestId('precheck-line-count')).toHaveText('2');
    await expect(page.getByTestId('record-card')).toBeVisible();
    await expect(page.getByTestId('record-font')).toHaveText('18px / 粗体');

    // 继续修改：任一输入变化仍让结论回到待测
    await page.getByTestId('precheck-title').fill('aaaa bbbb cccc');
    await expect(page.getByTestId('precheck-pending')).toBeVisible();
    await expect(page.getByTestId('record-card')).toBeVisible();
  });

  test('Canvas 不可用时展示测量失败且不写入存储', async ({ page }) => {
    await page.addInitScript(() => {
      HTMLCanvasElement.prototype.getContext = (() =>
        null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    });
    await page.goto('/precheck.html');

    await fillPrecheckForm(page, {
      title: 'aaaa bbbb',
      maxWidth: '100',
      fontSize: '20',
      maxLines: '2',
    });
    await page.getByTestId('precheck-submit').click();

    await expect(page.getByTestId('measure-failure')).toBeVisible();
    await expect(page.getByTestId('precheck-result')).toHaveCount(0);
    await expect(page.getByTestId('record-empty')).toBeVisible();
    const stored = await page.evaluate((key) => localStorage.getItem(key), PRECHECK_STORAGE_KEY);
    expect(stored).toBeNull();
  });

  test('画布可创建但测量报错时展示测量失败，旧记录与存储不被改写', async ({ page }) => {
    // 先完成一次合法预检，留下有效记录
    await page.goto('/precheck.html');
    await runValidPrecheck(page);
    await expect(page.getByTestId('record-verdict')).toHaveText('未超出行数');

    // 让画布可创建、但 measureText 抛错（开关可控，便于模拟“测量恢复”）
    await page.evaluate(() => {
      const original = CanvasRenderingContext2D.prototype.measureText;
      (window as unknown as { __measureFail: boolean }).__measureFail = true;
      CanvasRenderingContext2D.prototype.measureText = function (
        this: CanvasRenderingContext2D,
        text: string,
      ): TextMetrics {
        if ((window as unknown as { __measureFail: boolean }).__measureFail) {
          throw new DOMException('The canvas is no longer usable', 'InvalidStateError');
        }
        return original.call(this, text);
      };
    });

    // 编辑后重新提交：测量中途报错 → 展示测量失败，不中断、不写入存储
    await page.getByTestId('precheck-title').fill('aaaa bbbb cccc');
    await page.getByTestId('precheck-submit').click();
    await expect(page.getByTestId('measure-failure')).toBeVisible();
    await expect(page.getByTestId('precheck-result')).toHaveCount(0);

    // 最近一次有效记录原样保留，存储中的旧记录未被改写
    await expect(page.getByTestId('record-card')).toBeVisible();
    await expect(page.getByTestId('record-title')).toHaveText('aaaa bbbb');
    await expect(page.getByTestId('record-verdict')).toHaveText('未超出行数');
    const stored = await page.evaluate((key) => localStorage.getItem(key), PRECHECK_STORAGE_KEY);
    expect(JSON.parse(stored!).draft.title).toBe('aaaa bbbb');

    // 测量恢复后无需刷新即可继续预检，记录随之更新
    await page.evaluate(() => {
      (window as unknown as { __measureFail: boolean }).__measureFail = false;
    });
    await page.getByTestId('precheck-submit').click();
    await expect(page.getByTestId('measure-failure')).toHaveCount(0);
    await expect(page.getByTestId('precheck-result')).toBeVisible();
    await expect(page.getByTestId('record-title')).toHaveText('aaaa bbbb cccc');
  });
});
