import { expect, type Locator, test } from '@playwright/test';
import { makePng } from './helpers/png';

// 4×2 的色块图：每格一个不透明纯色，方便精确取色与复算。
// 左列：白 / 黑；右列：#123456 / #767676。
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
  // 真实鼠标点击，坐标为相对画布元素左上角的 CSS 像素
  await canvas.click({
    position: {
      x: (xCell + 0.5) * (box.width / 4),
      y: (yCell + 0.5) * (box.height / 2),
    },
  });
}

test.describe('本地图片取色核验', () => {
  test('上传图片 → 点击像素取色写入背景框（提示尚未提交）→ 核验进入结果链路', async ({ page }) => {
    await page.goto('/');

    await page
      .getByTestId('image-file')
      .setInputFiles({ name: 'wall.png', mimeType: 'image/png', buffer: samplePng() });

    await expect(page.getByTestId('sample-canvas')).toBeVisible();
    await expect(page.getByTestId('picker-status')).toContainText('图片已载入');

    // 取 #123456（右上格）
    const canvas = page.getByTestId('sample-canvas');
    const box = (await canvas.boundingBox())!;
    await clickCell(canvas, box, 2, 0);

    await expect(page.getByLabel('背景色 (#RRGGBB)')).toHaveValue('#123456');
    await expect(page.getByTestId('picker-status')).toContainText('本次采样尚未提交');
    // 采样不等于提交：旧的空状态仍在
    await expect(page.getByTestId('empty-state')).toBeVisible();

    // 沿用现有字号、字重与前景色走原有核验链路
    await page.getByLabel('前景色 (#RRGGBB)').fill('#000000');
    await page.getByLabel('字号 (CSS px)').fill('16');
    await page.getByRole('button', { name: '核验' }).click();

    await expect(page.getByTestId('result-card')).toBeVisible();
    await expect(page.getByTestId('result-background')).toHaveText('#123456');
    await expect(page.getByTestId('result-foreground')).toHaveText('#000000');
    await expect(page.getByTestId('picker-status')).not.toContainText('尚未提交');

    // 再取 #767676（右下格）为背景，以白色为前景：白对 #767676 约 4.542
    await page.getByLabel('前景色 (#RRGGBB)').fill('#FFFFFF');
    // 结果卡出现可能引起页面重排，取最新包围盒再点
    const box2 = (await canvas.boundingBox())!;
    await clickCell(canvas, box2, 3, 1);
    await expect(page.getByLabel('背景色 (#RRGGBB)')).toHaveValue('#767676');
    await expect(page.getByTestId('picker-status')).toContainText('本次采样尚未提交');
    await page.getByRole('button', { name: '核验' }).click();
    await expect(page.getByTestId('ratio-value')).toHaveText('4.54');
    await expect(page.getByTestId('result-foreground')).toHaveText('#FFFFFF');
    await expect(page.getByTestId('result-background')).toHaveText('#767676');
    await expect(page.getByTestId('verdict-normal-aa')).toHaveText('通过');
    await expect(page.getByTestId('picker-status')).not.toContainText('尚未提交');
  });

  test('非图片文件在取色区报错，背景输入与上一份有效结果均保留', async ({ page }) => {
    await page.goto('/');

    // 先取得一份有效结果
    await page.getByLabel('前景色 (#RRGGBB)').fill('#000000');
    await page.getByLabel('背景色 (#RRGGBB)').fill('#FFFFFF');
    await page.getByLabel('字号 (CSS px)').fill('16');
    await page.getByRole('button', { name: '核验' }).click();
    await expect(page.getByTestId('ratio-value')).toHaveText('21.00');

    // 选择非图片文件
    await page
      .getByTestId('image-file')
      .setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') });

    await expect(page.getByTestId('picker-status')).toContainText('不是图片文件');
    await expect(page.getByTestId('picker-placeholder')).toBeVisible();
    await expect(page.getByLabel('背景色 (#RRGGBB)')).toHaveValue('#FFFFFF');
    await expect(page.getByTestId('result-background')).toHaveText('#FFFFFF');
    await expect(page.getByTestId('ratio-value')).toHaveText('21.00');

    // 重新选择合法图片后可继续取色操作
    await page
      .getByTestId('image-file')
      .setInputFiles({ name: 'wall.png', mimeType: 'image/png', buffer: samplePng() });
    const canvas = page.getByTestId('sample-canvas');
    await expect(canvas).toBeVisible();
    const box = (await canvas.boundingBox())!;
    await clickCell(canvas, box, 2, 0);
    await expect(page.getByLabel('背景色 (#RRGGBB)')).toHaveValue('#123456');
  });

  test('解码失败在取色区报错，不覆盖背景输入与上一份有效结果', async ({ page }) => {
    await page.goto('/');

    // 先载入一张合法图片并取色、核验，得到有效结果
    await page
      .getByTestId('image-file')
      .setInputFiles({ name: 'wall.png', mimeType: 'image/png', buffer: samplePng() });
    const canvas = page.getByTestId('sample-canvas');
    const box = (await canvas.boundingBox())!;
    await clickCell(canvas, box, 0, 0);
    await expect(page.getByLabel('背景色 (#RRGGBB)')).toHaveValue('#FFFFFF');
    await page.getByLabel('前景色 (#RRGGBB)').fill('#000000');
    await page.getByRole('button', { name: '核验' }).click();
    await expect(page.getByTestId('ratio-value')).toHaveText('21.00');

    // 选择扩展名为图片、MIME 也是图片、但内容无法解码的文件
    await page.getByTestId('image-file').setInputFiles({
      name: 'broken.png',
      mimeType: 'image/png',
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3]),
    });

    await expect(page.getByTestId('picker-status')).toContainText('解码失败');
    // 已载入的画布仍可用，输入与结果不变
    await expect(page.getByTestId('sample-canvas')).toBeVisible();
    await expect(page.getByLabel('背景色 (#RRGGBB)')).toHaveValue('#FFFFFF');
    await expect(page.getByTestId('result-background')).toHaveText('#FFFFFF');
    await expect(page.getByTestId('ratio-value')).toHaveText('21.00');

    // 在仍保留的画布上取另一格，可继续操作
    await clickCell(canvas, box, 2, 0);
    await expect(page.getByLabel('背景色 (#RRGGBB)')).toHaveValue('#123456');
  });

  test('点击落在画布边界外时只提示原因，不改动背景输入', async ({ page }) => {
    await page.goto('/');
    await page
      .getByTestId('image-file')
      .setInputFiles({ name: 'wall.png', mimeType: 'image/png', buffer: samplePng() });
    const canvas = page.getByTestId('sample-canvas');
    await expect(canvas).toBeVisible();

    // 真实点击无法落在元素外，派发一个客户坐标明显在画布外的 click 事件
    await canvas.dispatchEvent('click', { clientX: -10, clientY: -10 });
    await expect(page.getByTestId('picker-status')).toContainText('画布边界外');
    await expect(page.getByLabel('背景色 (#RRGGBB)')).toHaveValue('#FFFFFF');
  });

  test('刷新不保留所选图片，手工填写背景色的路径不受影响', async ({ page }) => {
    await page.goto('/');
    await page
      .getByTestId('image-file')
      .setInputFiles({ name: 'wall.png', mimeType: 'image/png', buffer: samplePng() });
    await expect(page.getByTestId('sample-canvas')).toBeVisible();

    await page.reload();

    await expect(page.getByTestId('picker-placeholder')).toBeVisible();
    await expect(page.getByTestId('sample-canvas')).toHaveCount(0);

    // 手工填写背景色仍可走原有核验链路
    await page.getByLabel('前景色 (#RRGGBB)').fill('#000000');
    await page.getByLabel('背景色 (#RRGGBB)').fill('#FFFFFF');
    await page.getByLabel('字号 (CSS px)').fill('16');
    await page.getByRole('button', { name: '核验' }).click();
    await expect(page.getByTestId('ratio-value')).toHaveText('21.00');
    await expect(page.getByTestId('result-background')).toHaveText('#FFFFFF');
  });
});

test.describe('取色页面与原有用例共存', () => {
  test('不使用取色时原有合法输入流程照常', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('前景色 (#RRGGBB)').fill('#777777');
    await page.getByLabel('背景色 (#RRGGBB)').fill('#FFFFFF');
    await page.getByLabel('字号 (CSS px)').fill('20');
    await page.getByRole('radio', { name: '粗体' }).check();
    await page.getByRole('button', { name: '核验' }).click();
    await expect(page.getByTestId('ratio-value')).toHaveText('4.48');
    await expect(page.getByTestId('verdict-normal-aa')).toHaveText('未通过');
    await expect(page.getByTestId('verdict-large-aa')).toHaveText('通过');
  });
});
