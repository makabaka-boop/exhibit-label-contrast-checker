import { expect, type Locator, test } from '@playwright/test';
import { makePng } from './helpers/png';

// 与 picker.spec.ts 相同的 4×2 色块图：左列白 / 黑，右列 #123456 / #767676。
function samplePng(): Buffer {
  const colors: Record<string, [number, number, number, number]> = {
    white: [255, 255, 255, 255],
    black: [0, 0, 0, 255],
    navy: [0x12, 0x34, 0x56, 255],
    gray: [0x76, 0x76, 0x76, 255],
  };
  return makePng(4, 2, (x, y) => {
    if (x < 2) {
      return y === 0 ? colors.white : colors.black;
    }
    return y === 0 ? colors.navy : colors.gray;
  });
}

/** 点击画布中某个色块单元的中心：xCell/yCell 为 4×2 网格中的单元序号。 */
async function clickCell(
  canvas: Locator,
  box: { width: number; height: number },
  xCell: number,
  yCell: number,
) {
  await canvas.click({
    position: {
      x: (xCell + 0.5) * (box.width / 4),
      y: (yCell + 0.5) * (box.height / 2),
    },
  });
}

test.describe('半透明文字着色核验', () => {
  test('取色背景后设置半透明文字：生成有效前景色并进入既有裁决链路', async ({ page }) => {
    await page.goto('/');

    // 默认不透明：覆盖率输入不显示
    await expect(page.getByTestId('ink-mode-opaque')).toBeChecked();
    await expect(page.getByLabel('覆盖率（%，大于 0 且不超过 100）')).toHaveCount(0);

    // 从本地图片取白色（左上格）写入背景框
    await page
      .getByTestId('image-file')
      .setInputFiles({ name: 'wall.png', mimeType: 'image/png', buffer: samplePng() });
    const canvas = page.getByTestId('sample-canvas');
    await expect(canvas).toBeVisible();
    const box = (await canvas.boundingBox())!;
    await clickCell(canvas, box, 0, 0);
    await expect(page.getByLabel('背景色 (#RRGGBB)')).toHaveValue('#FFFFFF');
    await expect(page.getByTestId('picker-status')).toContainText('本次采样尚未提交');

    // 切到半透明并填写覆盖率
    await page.getByTestId('ink-mode-translucent').check();
    const coverage = page.getByLabel('覆盖率（%，大于 0 且不超过 100）');
    await expect(coverage).toBeVisible();
    await page.getByLabel('前景色 (#RRGGBB)').fill('#000000');
    await page.getByLabel('字号 (CSS px)').fill('16');
    await coverage.fill('50');
    await page.getByRole('button', { name: '核验' }).click();

    // 结果卡呈现计算依据：标称前景色、覆盖率、有效前景色（黑 50% 落于白 → #808080）
    await expect(page.getByTestId('result-card')).toBeVisible();
    await expect(page.getByTestId('result-ink')).toHaveText('半透明（覆盖率 50%）');
    await expect(page.getByTestId('result-foreground')).toHaveText('#000000');
    await expect(page.getByTestId('result-effective-foreground')).toHaveText('#808080');
    await expect(page.getByTestId('result-background')).toHaveText('#FFFFFF');
    // 有效前景 #808080 对白 ≈ 3.949：普通 AA 未通过、大号 AA 通过
    await expect(page.getByTestId('ratio-value')).toHaveText('3.95');
    await expect(page.getByTestId('verdict-normal-aa')).toHaveText('未通过');
    await expect(page.getByTestId('verdict-large-aa')).toHaveText('通过');
    await expect(page.getByTestId('verdict-large-aaa')).toHaveText('未通过');
    // 预览以有效前景色着墨
    await expect(page.getByTestId('preview')).toHaveCSS('color', 'rgb(128, 128, 128)');
    await expect(page.getByTestId('preview')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    // 核验通过后取色区撤下“尚未提交”提示
    await expect(page.getByTestId('picker-status')).not.toContainText('尚未提交');

    // 复制摘要：与结果卡同一对象呈现计算依据
    await page.getByTestId('copy-summary').click();
    await expect(page.getByTestId('copy-status')).toHaveText('已复制');
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toBe(
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

  test('黑签 30% 覆盖在 45 级深灰墙上：浮点误差下三个通道仍向上舍入为 #202020', async ({ page }) => {
    await page.goto('/');

    await page.getByTestId('ink-mode-translucent').check();
    await page.getByLabel('前景色 (#RRGGBB)').fill('#000000');
    await page.getByLabel('背景色 (#RRGGBB)').fill('#2D2D2D');
    await page.getByLabel('字号 (CSS px)').fill('16');
    await page.getByLabel('覆盖率（%，大于 0 且不超过 100）').fill('30');
    await page.getByRole('button', { name: '核验' }).click();

    // 45×0.7 在浮点下为 31.499999999999996，但 31.5 应向上舍入为 32，而非少一档的 31
    await expect(page.getByTestId('result-card')).toBeVisible();
    await expect(page.getByTestId('result-ink')).toHaveText('半透明（覆盖率 30%）');
    await expect(page.getByTestId('result-effective-foreground')).toHaveText('#202020');
    await expect(page.getByTestId('preview')).toHaveCSS('color', 'rgb(32, 32, 32)');
    await expect(page.getByTestId('preview')).toHaveCSS('background-color', 'rgb(45, 45, 45)');
  });

  test('非法覆盖率在字段旁说明原因，旧结果与取色区状态不被改写', async ({ page }) => {
    await page.goto('/');

    // 取 #123456 为背景并先做一份有效核验（不透明黑字）
    await page
      .getByTestId('image-file')
      .setInputFiles({ name: 'wall.png', mimeType: 'image/png', buffer: samplePng() });
    const canvas = page.getByTestId('sample-canvas');
    await expect(canvas).toBeVisible();
    const box = (await canvas.boundingBox())!;
    await clickCell(canvas, box, 2, 0);
    await expect(page.getByLabel('背景色 (#RRGGBB)')).toHaveValue('#123456');
    await page.getByLabel('前景色 (#RRGGBB)').fill('#000000');
    await page.getByLabel('字号 (CSS px)').fill('16');
    await page.getByRole('button', { name: '核验' }).click();
    await expect(page.getByTestId('result-card')).toBeVisible();
    await expect(page.getByTestId('result-background')).toHaveText('#123456');
    const ratioBefore = await page.getByTestId('ratio-value').textContent();

    // 再取一格 #767676：取色区进入“尚未提交”状态
    const box2 = (await canvas.boundingBox())!;
    await clickCell(canvas, box2, 3, 1);
    await expect(page.getByLabel('背景色 (#RRGGBB)')).toHaveValue('#767676');
    await expect(page.getByTestId('picker-status')).toContainText('本次采样尚未提交');

    // 切到半透明后提交各类非法覆盖率：逐一就地报错
    await page.getByTestId('ink-mode-translucent').check();
    const coverage = page.getByLabel('覆盖率（%，大于 0 且不超过 100）');
    const errorCoverage = page.getByTestId('error-coverage');

    await coverage.fill('50%');
    await page.getByRole('button', { name: '核验' }).click();
    await expect(errorCoverage).toContainText('纯数字');

    await coverage.fill('');
    await page.getByRole('button', { name: '核验' }).click();
    await expect(errorCoverage).toContainText('填写覆盖率');

    await coverage.fill('0');
    await page.getByRole('button', { name: '核验' }).click();
    await expect(errorCoverage).toContainText('大于 0 且不超过 100');

    await coverage.fill('101');
    await page.getByRole('button', { name: '核验' }).click();
    await expect(errorCoverage).toContainText('大于 0 且不超过 100');

    // 负覆盖率是有限数字：报“超出允许范围”，而不是误报为“不是纯数字/带单位”
    await coverage.fill('-5');
    await page.getByRole('button', { name: '核验' }).click();
    await expect(errorCoverage).toContainText('超出允许范围');
    await expect(errorCoverage).not.toContainText('纯数字');

    // Infinity：明确指出不是有限数值，而不是错误声称输入带单位
    await coverage.fill('Infinity');
    await page.getByRole('button', { name: '核验' }).click();
    await expect(errorCoverage).toContainText('有限数值');
    await expect(errorCoverage).not.toContainText('单位');

    // 整个过程中旧结果与取色区状态均未被改写
    await expect(page.getByTestId('result-card')).toBeVisible();
    await expect(page.getByTestId('result-background')).toHaveText('#123456');
    await expect(page.getByTestId('ratio-value')).toHaveText(ratioBefore!);
    await expect(page.getByTestId('picker-status')).toContainText('本次采样尚未提交');
    await expect(page.getByLabel('背景色 (#RRGGBB)')).toHaveValue('#767676');

    // 改为合法覆盖率后正常进入结果链路：黑字 60% 落于 #767676 → 各通道 118×0.4=47.2→47 → #2F2F2F
    await coverage.fill('60');
    await page.getByRole('button', { name: '核验' }).click();
    await expect(errorCoverage).toHaveCount(0);
    await expect(page.getByTestId('result-effective-foreground')).toHaveText('#2F2F2F');
    await expect(page.getByTestId('result-background')).toHaveText('#767676');
    await expect(page.getByTestId('picker-status')).not.toContainText('尚未提交');
  });

  test('默认不透明路径的结果、预览与摘要均与当前版本一致', async ({ page }) => {
    await page.goto('/');

    // 默认不透明，覆盖率输入不存在
    await expect(page.getByTestId('ink-mode-opaque')).toBeChecked();
    await expect(page.getByLabel('覆盖率（%，大于 0 且不超过 100）')).toHaveCount(0);

    await page.getByLabel('前景色 (#RRGGBB)').fill('#000000');
    await page.getByLabel('背景色 (#RRGGBB)').fill('#FFFFFF');
    await page.getByLabel('字号 (CSS px)').fill('20');
    await page.getByRole('radio', { name: '粗体' }).check();
    await page.getByRole('button', { name: '核验' }).click();

    // 结果卡与当前版本一致：无着色方式 / 有效前景色行，前景色即标称色
    await expect(page.getByTestId('result-ink')).toHaveCount(0);
    await expect(page.getByTestId('result-effective-foreground')).toHaveCount(0);
    await expect(page.getByTestId('result-foreground')).toHaveText('#000000');
    await expect(page.getByTestId('ratio-value')).toHaveText('21.00');
    await expect(page.getByTestId('text-class')).toHaveText('大号文字');
    await expect(page.getByTestId('preview')).toHaveCSS('color', 'rgb(0, 0, 0)');

    // 摘要与当前版本逐行一致
    await page.getByTestId('copy-summary').click();
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toBe(
      [
        '前景色: #000000',
        '背景色: #FFFFFF',
        '字号: 20px',
        '字重: 粗体',
        '文字分类: 大号文字',
        '对比度: 21.00',
        '普通文字 AA: 通过',
        '普通文字 AAA: 通过',
        '大号文字 AA: 通过',
        '大号文字 AAA: 通过',
      ].join('\n'),
    );

    // 切到半透明填写覆盖率后再切回不透明：输入隐藏，残留覆盖率不参与核验
    await page.getByTestId('ink-mode-translucent').check();
    await page.getByLabel('覆盖率（%，大于 0 且不超过 100）').fill('50');
    await page.getByTestId('ink-mode-opaque').check();
    await expect(page.getByLabel('覆盖率（%，大于 0 且不超过 100）')).toHaveCount(0);
    await page.getByRole('button', { name: '核验' }).click();
    await expect(page.getByTestId('result-ink')).toHaveCount(0);
    await expect(page.getByTestId('result-foreground')).toHaveText('#000000');
    await expect(page.getByTestId('ratio-value')).toHaveText('21.00');
    await expect(page.getByTestId('preview')).toHaveCSS('color', 'rgb(0, 0, 0)');
  });
});
