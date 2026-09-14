import { useState, type FormEvent } from 'react';
import {
  layoutLines,
  validatePrecheckDraft,
  type LayoutResult,
  type PrecheckErrors,
  type PrecheckFontWeight,
} from '../lib/linebreak';
import { createCanvasTextWidthAdapter, PRECHECK_FONT_FAMILY } from '../lib/canvasMeasure';
import {
  loadPrecheckRecord,
  savePrecheckRecord,
  type PrecheckDraftSnapshot,
  type PrecheckRecord,
} from '../lib/precheckStorage';

/** 一次成功测量的完整现场：草稿快照、解析值与排版结果。 */
interface MeasuredState {
  draft: PrecheckDraftSnapshot;
  fontSizePx: number;
  maxWidthPx: number;
  maxLines: number;
  result: LayoutResult;
}

const EMPTY_DRAFT: PrecheckDraftSnapshot = {
  title: '',
  maxWidth: '',
  fontSize: '',
  weight: 'normal',
  maxLines: '',
};

function formatWidth(widthPx: number): string {
  return `${widthPx.toFixed(2)} px`;
}

export default function PrecheckApp() {
  // 最近一次有效记录：挂载时从 localStorage 恢复，草稿像从未离开一样继续编辑。
  const [initialRecord] = useState<PrecheckRecord | null>(() => loadPrecheckRecord());
  const [draft, setDraft] = useState<PrecheckDraftSnapshot>(() => initialRecord?.draft ?? EMPTY_DRAFT);
  const [errors, setErrors] = useState<PrecheckErrors>({});
  const [measured, setMeasured] = useState<MeasuredState | null>(() => {
    if (!initialRecord) {
      return null;
    }
    return {
      draft: initialRecord.draft,
      fontSizePx: Number(initialRecord.draft.fontSize),
      maxWidthPx: Number(initialRecord.draft.maxWidth),
      maxLines: Number(initialRecord.draft.maxLines),
      result: initialRecord.result,
    };
  });
  const [record, setRecord] = useState<PrecheckRecord | null>(initialRecord);
  const [measureFailed, setMeasureFailed] = useState(false);

  // 任一输入变化都会让旧结论回到待测状态：只有当前草稿与测量现场逐项一致时结论才有效。
  const isFresh =
    measured !== null &&
    measured.draft.title === draft.title &&
    measured.draft.maxWidth === draft.maxWidth &&
    measured.draft.fontSize === draft.fontSize &&
    measured.draft.weight === draft.weight &&
    measured.draft.maxLines === draft.maxLines;

  function clearError(field: keyof PrecheckErrors) {
    setErrors((prev) => {
      if (!prev[field]) {
        return prev;
      }
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  function handleField(field: keyof PrecheckErrors, value: string) {
    setDraft((prev) => ({ ...prev, [field]: value }));
    clearError(field);
    setMeasureFailed(false);
  }

  function handleWeight(weight: PrecheckFontWeight) {
    setDraft((prev) => ({ ...prev, weight }));
    setMeasureFailed(false);
  }

  function showMeasureFailure() {
    // 测量失败（Canvas 不可用或测量过程报错）：清空当前结论，不写入存储，
    // 最近一次有效记录保持不变。
    setMeasured(null);
    setMeasureFailed(true);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const { errors: nextErrors, value } = validatePrecheckDraft(draft);
    setErrors(nextErrors);
    if (!value) {
      // 空文案、非正宽度、非正字号或无效行数：就地说明，最近一次有效记录保持不变。
      return;
    }
    const adapter = createCanvasTextWidthAdapter(value.fontSizePx, draft.weight);
    if (!adapter) {
      showMeasureFailure();
      return;
    }
    let result: LayoutResult;
    try {
      result = layoutLines(
        { text: value.text, maxWidthPx: value.maxWidthPx, maxLines: value.maxLines },
        adapter,
      );
    } catch {
      // 画布能创建但实际测量报错（如上下文丢失）：领域服务向上抛错，
      // 这里同样按测量失败处理，不写入存储。
      showMeasureFailure();
      return;
    }
    const snapshot: PrecheckDraftSnapshot = { ...draft };
    setMeasured({
      draft: snapshot,
      fontSizePx: value.fontSizePx,
      maxWidthPx: value.maxWidthPx,
      maxLines: value.maxLines,
      result,
    });
    const nextRecord: PrecheckRecord = { version: 1, draft: snapshot, result };
    setRecord(nextRecord);
    setMeasureFailed(false);
    savePrecheckRecord(nextRecord);
  }

  return (
    <main className="page">
      <h1>行长预检工作台</h1>
      <p className="lede">
        定稿前预检长标题能否装入既定展签版心：按实际字体测量，优先在空格处断行，
        排不下的连续文本按字符切分。本工作台独立于对比度核验台，互不影响。
      </p>
      <p className="nav">
        <a href="/">返回对比度核验台</a>
      </p>

      <form className="panel" onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label htmlFor="precheck-title">标题文案（可含显式换行）</label>
          <textarea
            id="precheck-title"
            name="precheckTitle"
            data-testid="precheck-title"
            rows={3}
            value={draft.title}
            onChange={(event) => handleField('title', event.target.value)}
            aria-invalid={Boolean(errors.title)}
            aria-describedby={errors.title ? 'precheck-title-error' : undefined}
            placeholder="输入展签标题"
            autoComplete="off"
            spellCheck={false}
          />
          {errors.title && (
            <p className="error" id="precheck-title-error" role="alert" data-testid="precheck-error-title">
              {errors.title}
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor="precheck-max-width">可用宽度 (CSS px)</label>
          <input
            id="precheck-max-width"
            name="precheckMaxWidth"
            data-testid="precheck-max-width"
            type="text"
            inputMode="decimal"
            value={draft.maxWidth}
            onChange={(event) => handleField('maxWidth', event.target.value)}
            aria-invalid={Boolean(errors.maxWidth)}
            aria-describedby={errors.maxWidth ? 'precheck-max-width-error' : undefined}
            placeholder="240"
            autoComplete="off"
          />
          {errors.maxWidth && (
            <p
              className="error"
              id="precheck-max-width-error"
              role="alert"
              data-testid="precheck-error-max-width"
            >
              {errors.maxWidth}
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor="precheck-font-size">字号 (CSS px)</label>
          <input
            id="precheck-font-size"
            name="precheckFontSize"
            data-testid="precheck-font-size"
            type="text"
            inputMode="decimal"
            value={draft.fontSize}
            onChange={(event) => handleField('fontSize', event.target.value)}
            aria-invalid={Boolean(errors.fontSize)}
            aria-describedby={errors.fontSize ? 'precheck-font-size-error' : undefined}
            placeholder="16"
            autoComplete="off"
          />
          {errors.fontSize && (
            <p
              className="error"
              id="precheck-font-size-error"
              role="alert"
              data-testid="precheck-error-font-size"
            >
              {errors.fontSize}
            </p>
          )}
        </div>

        <fieldset className="field weight">
          <legend>字重</legend>
          <label>
            <input
              type="radio"
              name="precheck-weight"
              value="normal"
              data-testid="precheck-weight-normal"
              checked={draft.weight === 'normal'}
              onChange={() => handleWeight('normal')}
            />
            普通
          </label>
          <label>
            <input
              type="radio"
              name="precheck-weight"
              value="bold"
              data-testid="precheck-weight-bold"
              checked={draft.weight === 'bold'}
              onChange={() => handleWeight('bold')}
            />
            粗体
          </label>
        </fieldset>

        <div className="field">
          <label htmlFor="precheck-max-lines">最大行数（正整数）</label>
          <input
            id="precheck-max-lines"
            name="precheckMaxLines"
            data-testid="precheck-max-lines"
            type="text"
            inputMode="numeric"
            value={draft.maxLines}
            onChange={(event) => handleField('maxLines', event.target.value)}
            aria-invalid={Boolean(errors.maxLines)}
            aria-describedby={errors.maxLines ? 'precheck-max-lines-error' : undefined}
            placeholder="2"
            autoComplete="off"
          />
          {errors.maxLines && (
            <p
              className="error"
              id="precheck-max-lines-error"
              role="alert"
              data-testid="precheck-error-max-lines"
            >
              {errors.maxLines}
            </p>
          )}
        </div>

        <button type="submit" className="primary" data-testid="precheck-submit">
          预检
        </button>
      </form>

      {isFresh && measured ? (
        <section className="panel result" data-testid="precheck-result" aria-live="polite">
          <h2>预检结论</h2>
          <p
            className={`precheck-verdict ${measured.result.exceedsMaxLines ? 'fail' : 'pass'}`}
            data-testid="precheck-verdict"
          >
            {measured.result.exceedsMaxLines
              ? `超出行数：共 ${measured.result.lineCount} 行，超过 ${measured.maxLines} 行上限`
              : `未超出行数：共 ${measured.result.lineCount} 行，在 ${measured.maxLines} 行上限内`}
          </p>
          <dl className="facts">
            <div>
              <dt>排版行数</dt>
              <dd data-testid="precheck-line-count">{measured.result.lineCount}</dd>
            </div>
            <div>
              <dt>最长行宽</dt>
              <dd data-testid="precheck-longest-width">
                {formatWidth(measured.result.longestLineWidthPx)}
              </dd>
            </div>
            <div>
              <dt>可用宽度</dt>
              <dd data-testid="precheck-used-max-width">{measured.maxWidthPx} px</dd>
            </div>
            <div>
              <dt>字号 / 字重</dt>
              <dd data-testid="precheck-used-font">
                {measured.fontSizePx}px / {measured.draft.weight === 'bold' ? '粗体' : '普通'}
              </dd>
            </div>
          </dl>
          <ol className="precheck-lines" data-testid="precheck-lines">
            {measured.result.lines.map((line, index) => (
              <li key={index}>
                <span
                  className="precheck-line-text"
                  data-testid={`precheck-line-${index}`}
                  style={{
                    fontSize: `${measured.fontSizePx}px`,
                    fontWeight: measured.draft.weight === 'bold' ? 700 : 400,
                    fontFamily: PRECHECK_FONT_FAMILY,
                  }}
                >
                  {line.text === '' ? '（空行）' : line.text}
                </span>
                <span className="precheck-line-width" data-testid={`precheck-line-width-${index}`}>
                  {formatWidth(line.widthPx)}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : measureFailed ? (
        <p className="error panel-error" data-testid="measure-failure" role="alert">
          测量失败：当前浏览器无法完成 Canvas 文本测量，未生成结论，也未写入任何记录。
        </p>
      ) : (
        <p className="empty" data-testid="precheck-pending">
          待测：尚未预检或输入已变化，旧结论已失效；请填写完整后点击“预检”。
        </p>
      )}

      <section className="panel" aria-labelledby="precheck-record-title">
        <h2 id="precheck-record-title">最近一次有效记录</h2>
        {record ? (
          <dl className="facts" data-testid="record-card">
            <div>
              <dt>标题</dt>
              <dd className="record-title" data-testid="record-title">
                {record.draft.title}
              </dd>
            </div>
            <div>
              <dt>可用宽度</dt>
              <dd data-testid="record-max-width">{record.draft.maxWidth} px</dd>
            </div>
            <div>
              <dt>字号 / 字重</dt>
              <dd data-testid="record-font">
                {record.draft.fontSize}px / {record.draft.weight === 'bold' ? '粗体' : '普通'}
              </dd>
            </div>
            <div>
              <dt>排版行数 / 上限</dt>
              <dd data-testid="record-lines">
                {record.result.lineCount} / {record.draft.maxLines}
              </dd>
            </div>
            <div>
              <dt>最长行宽</dt>
              <dd data-testid="record-longest-width">
                {formatWidth(record.result.longestLineWidthPx)}
              </dd>
            </div>
            <div>
              <dt>结论</dt>
              <dd data-testid="record-verdict">
                {record.result.exceedsMaxLines ? '超出行数' : '未超出行数'}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="empty" data-testid="record-empty">
            暂无有效记录：完成一次合法预检后会写入本机浏览器存储，刷新后可恢复。
          </p>
        )}
      </section>
    </main>
  );
}
