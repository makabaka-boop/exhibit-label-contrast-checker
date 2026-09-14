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

// 5×5 纹理图：中心 (2,2) 邻域内除中心 #080907 外 8 像素为纯黑；
// 左上 2×2 中 (0,0) 为 #141E28，其余三像素为纯黑（两个邻域不重叠）；
// 邻域外一律品红，用于让越界读取或邻域尺寸错误立刻暴露。
function texturePng(): Buffer {
  const magenta: [number, number, number, number] = [255, 0, 255, 255];
  const black: [number, number, number, number] = [0, 0, 0, 255];
  return makePng(5, 5, (x, y) => {
    if (x === 2 && y === 2) {
      return [0x08, 0x09, 0x07, 255];
    }
    if (x === 0 && y === 0) {
      return [0x14, 0x1e, 0x28, 255]; // (20,30,40)
    }
    const inCenterPatch = x >= 1 && x <= 3 && y >= 1 && y <= 3;
    const inCornerPatch = x <= 1 && y <= 1;
    return inCenterPatch || inCornerPatch ? black : magenta;
  });
}

/** 点击 5×5 纹理图中指定像素单元的中心。 */
async function clickTextureCell(
  canvas: Locator,
  box: { width: number; height: number },
  xCell: number,
  yCell: number,
) {
  await canvas.click({
    position: {
      x: (xCell + 0.5) * (box.width / 5),
      y: (yCell + 0.5) * (box.height / 5),
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

  test('点击画布最右侧装饰边框时提示不在图片区域，不采样末列颜色', async ({ page }) => {
    await page.goto('/');
    await page
      .getByTestId('image-file')
      .setInputFiles({ name: 'wall.png', mimeType: 'image/png', buffer: samplePng() });
    const canvas = page.getByTestId('sample-canvas');
    await expect(canvas).toBeVisible();

    // 合成一个落在最右侧 1px 装饰边框上的点击（元素边界内、图片内容外）
    await canvas.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      el.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: rect.right - 1,
          clientY: rect.top + rect.height / 2,
        }),
      );
    });
    await expect(page.getByTestId('picker-status')).toContainText('画布边界外');
    await expect(page.getByTestId('picker-status')).toContainText('图片区域');
    // 未取色：背景输入保持原值，而不是末列的 #767676
    await expect(page.getByLabel('背景色 (#RRGGBB)')).toHaveValue('#FFFFFF');

    // 边框内侧的末列像素仍可正常取色
    const box = (await canvas.boundingBox())!;
    await clickCell(canvas, box, 3, 1);
    await expect(page.getByLabel('背景色 (#RRGGBB)')).toHaveValue('#767676');
  });

  test('采样后手工改动背景色，取色区提示与当前背景输入保持一致', async ({ page }) => {
    await page.goto('/');
    await page
      .getByTestId('image-file')
      .setInputFiles({ name: 'wall.png', mimeType: 'image/png', buffer: samplePng() });
    const canvas = page.getByTestId('sample-canvas');
    await expect(canvas).toBeVisible();
    const box = (await canvas.boundingBox())!;
    await clickCell(canvas, box, 2, 0);
    await expect(page.getByLabel('背景色 (#RRGGBB)')).toHaveValue('#123456');
    await expect(page.getByTestId('picker-status')).toContainText('本次采样尚未提交');

    // 手工把背景改成另一色值：取色区不得再宣称旧采样值已写入
    await page.getByLabel('背景色 (#RRGGBB)').fill('#ABCDEF');
    await expect(page.getByTestId('picker-status')).not.toContainText('尚未提交');
    await expect(page.getByTestId('picker-status')).not.toContainText('#123456');
    await expect(page.getByTestId('picker-status')).toContainText('图片已载入');

    // 手工色值照常进入核验链路
    await page.getByLabel('前景色 (#RRGGBB)').fill('#000000');
    await page.getByLabel('字号 (CSS px)').fill('16');
    await page.getByRole('button', { name: '核验' }).click();
    await expect(page.getByTestId('result-background')).toHaveText('#ABCDEF');
  });

  test('未携带类型信息的文本文件报“不是图片”，无类型但内容合法的图片仍可载入', async ({ page }) => {
    await page.goto('/');

    // 先取得一份有效结果，确认误报不会覆盖既有状态
    await page.getByLabel('前景色 (#RRGGBB)').fill('#000000');
    await page.getByLabel('背景色 (#RRGGBB)').fill('#FFFFFF');
    await page.getByLabel('字号 (CSS px)').fill('16');
    await page.getByRole('button', { name: '核验' }).click();
    await expect(page.getByTestId('ratio-value')).toHaveText('21.00');

    // 无扩展名、无 MIME 类型的纯文本文件
    await page
      .getByTestId('image-file')
      .setInputFiles({ name: 'notes', mimeType: '', buffer: Buffer.from('just plain text') });

    await expect(page.getByTestId('picker-status')).toContainText('不是图片文件');
    await expect(page.getByTestId('picker-status')).not.toContainText('解码失败');
    await expect(page.getByTestId('picker-placeholder')).toBeVisible();
    await expect(page.getByLabel('背景色 (#RRGGBB)')).toHaveValue('#FFFFFF');
    await expect(page.getByTestId('ratio-value')).toHaveText('21.00');

    // 内容合法但未携带类型信息的图片仍可正常载入、取色
    await page
      .getByTestId('image-file')
      .setInputFiles({ name: 'wall', mimeType: '', buffer: samplePng() });
    const canvas = page.getByTestId('sample-canvas');
    await expect(canvas).toBeVisible();
    const box = (await canvas.boundingBox())!;
    await clickCell(canvas, box, 2, 0);
    await expect(page.getByLabel('背景色 (#RRGGBB)')).toHaveValue('#123456');
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
  test('取色方式默认“单点”：载入图片后取到点击处原像素颜色', async ({ page }) => {
    await page.goto('/');
    await page
      .getByTestId('image-file')
      .setInputFiles({ name: 'texture.png', mimeType: 'image/png', buffer: texturePng() });
    const canvas = page.getByTestId('sample-canvas');
    await expect(canvas).toBeVisible();

    // 默认档位为单点，且取色区文案仍是单像素口径
    await expect(page.getByTestId('sample-mode-single')).toBeChecked();
    await expect(page.getByTestId('sample-mode-average')).not.toBeChecked();
    await expect(page.getByTestId('picker-status')).toContainText('点击画布中的像素取色');

    // 点击中心特殊像素：单点路径直接得到原像素 #080907，而不是邻域平均色
    const box = (await canvas.boundingBox())!;
    await clickTextureCell(canvas, box, 2, 2);
    await expect(page.getByLabel('背景色 (#RRGGBB)')).toHaveValue('#080907');
    await expect(page.getByTestId('picker-status')).not.toContainText('区域平均');

    // 切到区域平均再切回单点后，行为仍是单像素取色
    await page.getByTestId('sample-mode-average').check();
    await page.getByTestId('sample-mode-single').check();
    await clickTextureCell(canvas, box, 0, 0);
    await expect(page.getByLabel('背景色 (#RRGGBB)')).toHaveValue('#141E28');
  });

  test('区域平均：载入纹理图 → 切换 → 点击取 3×3 平均色 → 提交核验走原有链路', async ({ page }) => {
    await page.goto('/');
    await page
      .getByTestId('image-file')
      .setInputFiles({ name: 'texture.png', mimeType: 'image/png', buffer: texturePng() });
    const canvas = page.getByTestId('sample-canvas');
    await expect(canvas).toBeVisible();

    // 切到区域平均后，取色区文案说明 3×3 口径
    await page.getByTestId('sample-mode-average').check();
    await expect(page.getByTestId('sample-mode-single')).not.toBeChecked();
    await expect(page.getByTestId('picker-status')).toContainText('3×3');

    // 点击中心 (2,2)：#080907 + 8 个纯黑 → 平均 (1,1,1) = #010101（通道分别四舍五入）
    const box = (await canvas.boundingBox())!;
    await clickTextureCell(canvas, box, 2, 2);
    const background = page.getByLabel('背景色 (#RRGGBB)');
    await expect(background).toHaveValue('#010101');
    await expect(page.getByTestId('picker-status')).toContainText('3×3 区域平均');
    await expect(page.getByTestId('picker-status')).toContainText('计入 9 个像素');
    await expect(page.getByTestId('picker-status')).toContainText('本次采样尚未提交');

    // 沿用原有核验按钮进入既有计算链路
    await page.getByLabel('前景色 (#RRGGBB)').fill('#FFFFFF');
    await page.getByLabel('字号 (CSS px)').fill('16');
    await page.getByRole('button', { name: '核验' }).click();
    await expect(page.getByTestId('result-card')).toBeVisible();
    await expect(page.getByTestId('result-background')).toHaveText('#010101');
    await expect(page.getByTestId('result-foreground')).toHaveText('#FFFFFF');
    // 白对近黑的 #010101，对比度约 20.87，四项全部通过
    await expect(page.getByTestId('ratio-value')).toHaveText('20.87');
    await expect(page.getByTestId('verdict-normal-aaa')).toHaveText('通过');
    await expect(page.getByTestId('picker-status')).not.toContainText('尚未提交');

    // 边缘裁剪：点击左上角 (0,0)，邻域只有 2×2 范围
    const box2 = (await canvas.boundingBox())!;
    await clickTextureCell(canvas, box2, 0, 0);
    // #141E28(20,30,40) 与三个纯黑的 2×2 平均：5、8、10 → #05080A，计入 4 个像素
    await expect(background).toHaveValue('#05080A');
    await expect(page.getByTestId('picker-status')).toContainText('计入 4 个像素');
  });

  test('区域读取失败时取色区说明原因，背景输入与已显示结果保持原样', async ({ page }) => {
    await page.goto('/');

    // 先取得一份有效结果，确认读取失败不影响已显示结果
    await page.getByLabel('前景色 (#RRGGBB)').fill('#000000');
    await page.getByLabel('背景色 (#RRGGBB)').fill('#FFFFFF');
    await page.getByLabel('字号 (CSS px)').fill('16');
    await page.getByRole('button', { name: '核验' }).click();
    await expect(page.getByTestId('ratio-value')).toHaveText('21.00');

    await page
      .getByTestId('image-file')
      .setInputFiles({ name: 'texture.png', mimeType: 'image/png', buffer: texturePng() });
    const canvas = page.getByTestId('sample-canvas');
    await expect(canvas).toBeVisible();
    await page.getByTestId('sample-mode-average').check();

    // 模拟区域读取抛错（与跨域画布安全错误同型），通过开关控制便于模拟“恢复读取”
    await canvas.evaluate((el) => {
      const context = (el as HTMLCanvasElement).getContext('2d')!;
      const original = context.getImageData.bind(context);
      (context as unknown as { __readFail?: boolean }).__readFail = true;
      context.getImageData = ((...args: Parameters<CanvasRenderingContext2D['getImageData']>) => {
        if ((context as unknown as { __readFail?: boolean }).__readFail) {
          throw new DOMException('The canvas has been tainted', 'SecurityError');
        }
        return original(...args);
      }) as CanvasRenderingContext2D['getImageData'];
    });
    const box = (await canvas.boundingBox())!;
    await clickTextureCell(canvas, box, 2, 2);

    await expect(page.getByTestId('picker-status')).toContainText('读取该区域失败');
    await expect(page.getByTestId('picker-status')).toContainText('未改动');
    await expect(page.getByLabel('背景色 (#RRGGBB)')).toHaveValue('#FFFFFF');
    await expect(page.getByTestId('result-background')).toHaveText('#FFFFFF');
    await expect(page.getByTestId('ratio-value')).toHaveText('21.00');

    // 恢复读取后无需重新载入图片，即可继续按区域平均取色
    await canvas.evaluate((el) => {
      const context = (el as HTMLCanvasElement).getContext('2d')!;
      (context as unknown as { __readFail?: boolean }).__readFail = false;
    });
    await clickTextureCell(canvas, box, 2, 2);
    await expect(page.getByLabel('背景色 (#RRGGBB)')).toHaveValue('#010101');
    await expect(page.getByTestId('picker-status')).toContainText('计入 9 个像素');
    await expect(page.getByTestId('ratio-value')).toHaveText('21.00');

    // 刷新后图片不保留、档位约定复位为默认单点
    await page.reload();
    await expect(page.getByTestId('picker-placeholder')).toBeVisible();
    await expect(page.getByTestId('sample-mode-single')).toBeChecked();
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
