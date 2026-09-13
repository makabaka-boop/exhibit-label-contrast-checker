import { useState, type FormEvent } from 'react';
import {
  buildPlainTextSummary,
  formatRatio,
  validateInputs,
  verifyContrast,
  type FontWeight,
  type FormErrors,
  type VerificationResult,
} from './lib/contrast';

const PASS = '通过';
const FAIL = '未通过';

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // 非安全上下文（如非 localhost 的 http）下的回退方案
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

export default function App() {
  const [foreground, setForeground] = useState('#000000');
  const [background, setBackground] = useState('#FFFFFF');
  const [fontSize, setFontSize] = useState('16');
  const [weight, setWeight] = useState<FontWeight>('normal');
  const [errors, setErrors] = useState<FormErrors>({});
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [copied, setCopied] = useState(false);

  function clearError(field: keyof FormErrors) {
    setErrors((prev) => {
      if (!prev[field]) {
        return prev;
      }
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const { errors: nextErrors, fontSizePx } = validateInputs({ foreground, background, fontSize });
    setErrors(nextErrors);
    if (fontSizePx === null || Object.keys(nextErrors).length > 0) {
      // 任一字段非法：就地报错，保留上一份有效结果
      return;
    }
    setResult(verifyContrast({ foreground, background, fontSizePx, weight }));
    setCopied(false);
  }

  async function handleCopy() {
    if (!result) {
      return;
    }
    await copyText(buildPlainTextSummary(result));
    setCopied(true);
  }

  return (
    <main className="page">
      <h1>博物馆展签对比度核验台</h1>
      <p className="lede">
        送印前以相对亮度公式核验前景/背景配色。裁决使用未舍入对比度，等于阈值即通过；展示值四舍五入到两位。
      </p>

      <form className="panel" onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label htmlFor="foreground">前景色 (#RRGGBB)</label>
          <input
            id="foreground"
            name="foreground"
            type="text"
            value={foreground}
            onChange={(event) => {
              setForeground(event.target.value);
              clearError('foreground');
            }}
            aria-invalid={Boolean(errors.foreground)}
            aria-describedby={errors.foreground ? 'foreground-error' : undefined}
            placeholder="#000000"
            autoComplete="off"
            spellCheck={false}
          />
          {errors.foreground && (
            <p className="error" id="foreground-error" role="alert" data-testid="error-foreground">
              {errors.foreground}
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor="background">背景色 (#RRGGBB)</label>
          <input
            id="background"
            name="background"
            type="text"
            value={background}
            onChange={(event) => {
              setBackground(event.target.value);
              clearError('background');
            }}
            aria-invalid={Boolean(errors.background)}
            aria-describedby={errors.background ? 'background-error' : undefined}
            placeholder="#FFFFFF"
            autoComplete="off"
            spellCheck={false}
          />
          {errors.background && (
            <p className="error" id="background-error" role="alert" data-testid="error-background">
              {errors.background}
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor="font-size">字号 (CSS px)</label>
          <input
            id="font-size"
            name="fontSize"
            type="text"
            inputMode="decimal"
            value={fontSize}
            onChange={(event) => {
              setFontSize(event.target.value);
              clearError('fontSize');
            }}
            aria-invalid={Boolean(errors.fontSize)}
            aria-describedby={errors.fontSize ? 'font-size-error' : undefined}
            placeholder="16"
            autoComplete="off"
          />
          {errors.fontSize && (
            <p className="error" id="font-size-error" role="alert" data-testid="error-font-size">
              {errors.fontSize}
            </p>
          )}
        </div>

        <fieldset className="field weight">
          <legend>字重</legend>
          <label>
            <input
              type="radio"
              name="weight"
              value="normal"
              checked={weight === 'normal'}
              onChange={() => setWeight('normal')}
            />
            普通
          </label>
          <label>
            <input
              type="radio"
              name="weight"
              value="bold"
              checked={weight === 'bold'}
              onChange={() => setWeight('bold')}
            />
            粗体
          </label>
        </fieldset>

        <button type="submit" className="primary">
          核验
        </button>
      </form>

      {result ? (
        <section className="panel result" data-testid="result-card" aria-live="polite">
          <h2>核验结果</h2>
          <div
            className="preview"
            data-testid="preview"
            style={{
              color: result.foreground,
              backgroundColor: result.background,
              fontSize: `${result.fontSizePx}px`,
              fontWeight: result.weight === 'bold' ? 700 : 400,
            }}
          >
            博物馆展签示例 Aa 123
          </div>
          <dl className="facts">
            <div>
              <dt>前景色</dt>
              <dd data-testid="result-foreground">{result.foreground}</dd>
            </div>
            <div>
              <dt>背景色</dt>
              <dd data-testid="result-background">{result.background}</dd>
            </div>
            <div>
              <dt>字号 / 字重</dt>
              <dd data-testid="result-font">
                {result.fontSizePx}px / {result.weight === 'bold' ? '粗体' : '普通'}
              </dd>
            </div>
            <div>
              <dt>文字分类</dt>
              <dd data-testid="text-class">{result.isLargeText ? '大号文字' : '普通文字'}</dd>
            </div>
            <div>
              <dt>对比度</dt>
              <dd data-testid="ratio-value">{formatRatio(result.ratio)}</dd>
            </div>
          </dl>
          <table className="verdicts">
            <thead>
              <tr>
                <th scope="col">级别</th>
                <th scope="col">普通文字</th>
                <th scope="col">大号文字</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">AA</th>
                <td data-testid="verdict-normal-aa" className={result.verdicts.normalAA ? 'pass' : 'fail'}>
                  {result.verdicts.normalAA ? PASS : FAIL}
                </td>
                <td data-testid="verdict-large-aa" className={result.verdicts.largeAA ? 'pass' : 'fail'}>
                  {result.verdicts.largeAA ? PASS : FAIL}
                </td>
              </tr>
              <tr>
                <th scope="row">AAA</th>
                <td data-testid="verdict-normal-aaa" className={result.verdicts.normalAAA ? 'pass' : 'fail'}>
                  {result.verdicts.normalAAA ? PASS : FAIL}
                </td>
                <td data-testid="verdict-large-aaa" className={result.verdicts.largeAAA ? 'pass' : 'fail'}>
                  {result.verdicts.largeAAA ? PASS : FAIL}
                </td>
              </tr>
            </tbody>
          </table>
          <div className="actions">
            <button type="button" data-testid="copy-summary" onClick={handleCopy}>
              复制纯文本摘要
            </button>
            {copied && (
              <span data-testid="copy-status" role="status" className="copied">
                已复制
              </span>
            )}
          </div>
        </section>
      ) : (
        <p className="empty" data-testid="empty-state">
          尚无有效结果：请提交合法的前景色、背景色与字号。
        </p>
      )}
    </main>
  );
}
