import type { LayoutResult, PrecheckFontWeight } from './linebreak';

/** 最近一次有效记录在 localStorage 中的键（带版本号，便于将来迁移）。 */
export const PRECHECK_STORAGE_KEY = 'museum-label-line-precheck:v1';

/** 随记录一起保存的表单草稿原值：刷新后按原样恢复，可继续修改。 */
export interface PrecheckDraftSnapshot {
  title: string;
  maxWidth: string;
  fontSize: string;
  weight: PrecheckFontWeight;
  maxLines: string;
}

/** 最近一次有效预检记录：草稿快照 + 排版结果。 */
export interface PrecheckRecord {
  version: 1;
  draft: PrecheckDraftSnapshot;
  result: LayoutResult;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** 防御性校验存储内容：任何字段形状不符都视为无记录（不抛错、不阻断页面）。 */
function parsePrecheckRecord(value: unknown): PrecheckRecord | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Partial<PrecheckRecord>;
  if (record.version !== 1) {
    return null;
  }
  const draft = record.draft as Partial<PrecheckDraftSnapshot> | undefined;
  if (
    typeof draft !== 'object' ||
    draft === null ||
    typeof draft.title !== 'string' ||
    typeof draft.maxWidth !== 'string' ||
    typeof draft.fontSize !== 'string' ||
    (draft.weight !== 'normal' && draft.weight !== 'bold') ||
    typeof draft.maxLines !== 'string'
  ) {
    return null;
  }
  const result = record.result as Partial<LayoutResult> | undefined;
  if (
    typeof result !== 'object' ||
    result === null ||
    !Array.isArray(result.lines) ||
    !result.lines.every(
      (line) =>
        typeof line === 'object' &&
        line !== null &&
        typeof (line as { text?: unknown }).text === 'string' &&
        isFiniteNumber((line as { widthPx?: unknown }).widthPx),
    ) ||
    !isFiniteNumber(result.longestLineWidthPx) ||
    !isFiniteNumber(result.lineCount) ||
    typeof result.exceedsMaxLines !== 'boolean'
  ) {
    return null;
  }
  return record as PrecheckRecord;
}

/** 读取最近一次有效记录；无记录、记录损坏或存储不可用时返回 null。 */
export function loadPrecheckRecord(): PrecheckRecord | null {
  try {
    const raw = localStorage.getItem(PRECHECK_STORAGE_KEY);
    if (raw === null) {
      return null;
    }
    return parsePrecheckRecord(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** 写入最近一次有效记录；存储不可用（如隐私模式）时静默跳过，页面结果不受影响。 */
export function savePrecheckRecord(record: PrecheckRecord): void {
  try {
    localStorage.setItem(PRECHECK_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // 存储不可用时结果已在页面展示，仅失去刷新恢复能力。
  }
}
