import { expect, test } from '@playwright/test';

test.describe('博物馆展签对比度核验台', () => {
  test('合法输入给出唯一且可复算的结论', async ({ page }) => {
    await page.goto('/');

    // 黑白配色：对比度 21.00，四项全部通过，16px 普通字重归为普通文字
    await page.getByLabel('前景色').fill('#000000');
    await page.getByLabel('背景色').fill('#FFFFFF');
    await page.getByLabel('字号').fill('16');
    await page.getByRole('radio', { name: '普通' }).check();
    await page.getByRole('button', { name: '核验' }).click();

    await expect(page.getByTestId('ratio-value')).toHaveText('21.00');
    await expect(page.getByTestId('text-class')).toHaveText('普通文字');
    await expect(page.getByTestId('verdict-normal-aa')).toHaveText('通过');
    await expect(page.getByTestId('verdict-normal-aaa')).toHaveText('通过');
    await expect(page.getByTestId('verdict-large-aa')).toHaveText('通过');
    await expect(page.getByTestId('verdict-large-aaa')).toHaveText('通过');
    await expect(page.getByTestId('result-foreground')).toHaveText('#000000');
    await expect(page.getByTestId('result-background')).toHaveText('#FFFFFF');

    // 临界样例 #777777：未舍入值 ≈4.478 < 4.5，普通 AA 不通过、大号 AA 通过
    await page.getByLabel('前景色').fill('#777777');
    await page.getByRole('button', { name: '核验' }).click();

    await expect(page.getByTestId('ratio-value')).toHaveText('4.48');
    await expect(page.getByTestId('verdict-normal-aa')).toHaveText('未通过');
    await expect(page.getByTestId('verdict-normal-aaa')).toHaveText('未通过');
    await expect(page.getByTestId('verdict-large-aa')).toHaveText('通过');
    await expect(page.getByTestId('verdict-large-aaa')).toHaveText('未通过');

    // #767676 ≈4.542 ≥ 4.5，18.66px 粗体归为大号文字
    await page.getByLabel('前景色').fill('#767676');
    await page.getByLabel('字号').fill('18.66');
    await page.getByRole('radio', { name: '粗体' }).check();
    await page.getByRole('button', { name: '核验' }).click();

    await expect(page.getByTestId('ratio-value')).toHaveText('4.54');
    await expect(page.getByTestId('text-class')).toHaveText('大号文字');
    await expect(page.getByTestId('verdict-normal-aa')).toHaveText('通过');
    await expect(page.getByTestId('verdict-normal-aaa')).toHaveText('未通过');
    await expect(page.getByTestId('verdict-large-aa')).toHaveText('通过');
    await expect(page.getByTestId('verdict-large-aaa')).toHaveText('通过');
  });

  test('非法输入就地报错并保留上一份有效结果', async ({ page }) => {
    await page.goto('/');

    // 先得到一份有效结果
    await page.getByLabel('前景色').fill('#000000');
    await page.getByLabel('背景色').fill('#FFFFFF');
    await page.getByLabel('字号').fill('16');
    await page.getByRole('button', { name: '核验' }).click();
    await expect(page.getByTestId('ratio-value')).toHaveText('21.00');

    // 再提交全部非法的字段
    await page.getByLabel('前景色').fill('#12345');
    await page.getByLabel('背景色').fill('blue');
    await page.getByLabel('字号').fill('0');
    await page.getByRole('button', { name: '核验' }).click();

    // 就地报错
    await expect(page.getByTestId('error-foreground')).toBeVisible();
    await expect(page.getByTestId('error-background')).toBeVisible();
    await expect(page.getByTestId('error-font-size')).toBeVisible();

    // 上一份有效结果原样保留
    await expect(page.getByTestId('result-card')).toBeVisible();
    await expect(page.getByTestId('ratio-value')).toHaveText('21.00');
    await expect(page.getByTestId('result-foreground')).toHaveText('#000000');
    await expect(page.getByTestId('result-background')).toHaveText('#FFFFFF');
    await expect(page.getByTestId('verdict-normal-aa')).toHaveText('通过');
  });

  test('复制的纯文本摘要与当前结果一致', async ({ page }) => {
    await page.goto('/');

    await page.getByLabel('前景色').fill('#000000');
    await page.getByLabel('背景色').fill('#FFFFFF');
    await page.getByLabel('字号').fill('20');
    await page.getByRole('radio', { name: '粗体' }).check();
    await page.getByRole('button', { name: '核验' }).click();
    await expect(page.getByTestId('ratio-value')).toHaveText('21.00');
    await expect(page.getByTestId('text-class')).toHaveText('大号文字');

    await page.getByTestId('copy-summary').click();
    await expect(page.getByTestId('copy-status')).toHaveText('已复制');

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
  });
});
