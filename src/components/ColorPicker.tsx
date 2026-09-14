import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent,
} from 'react';
import {
  averageNeighborhood,
  hasKnownImageSignature,
  mapDisplayPointToImagePixel,
  rgbChannelsToHex,
  type SampleMode,
} from '../lib/sample';

const IDLE_TEXT: Record<SampleMode, string> = {
  single:
    '选择展墙照片或纹理底图，载入后点击画布中的像素取色（默认“单点”）；采样仅写入背景用色输入框，不会自行提交。',
  average:
    '已选择“区域平均”：载入图片后点击像素，将取其周围 3×3 邻域的算术平均色（触及边缘时只计算范围内像素），结果仅写入背景用色输入框，不会自行提交。',
};
const LOADED_TEXT: Record<SampleMode, string> = {
  single: '图片已载入：点击画布中的像素取色，采样按图片原始尺寸换算。',
  average:
    '图片已载入（区域平均）：点击像素后取其周围 3×3 邻域的平均色，邻域触及图片边缘时只计算范围内像素。',
};

type PickerStatus =
  | { kind: 'idle' | 'info' | 'success' | 'error'; text: string };

interface LoadedImage {
  naturalWidth: number;
  naturalHeight: number;
}

interface ColorPickerProps {
  /** 取色结果（不透明六位色值）交由页面写入背景色输入框。 */
  onPick: (hex: string) => void;
  /** 页面每次完成一次有效核验后递增，用于撤下“尚未提交”的提示。 */
  committedNonce: number;
  /** 背景色输入框的当前值：采样已写入的提示只在输入仍等于采样值时成立。 */
  backgroundValue: string;
}

export default function ColorPicker({ onPick, committedNonce, backgroundValue }: ColorPickerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const loadIdRef = useRef(0);
  // 取色方式默认“单点”；ref 供 committedNonce 等不随模式重建的副作用读取当前值。
  const [mode, setMode] = useState<SampleMode>('single');
  const modeRef = useRef<SampleMode>('single');
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [status, setStatus] = useState<PickerStatus>({ kind: 'idle', text: IDLE_TEXT.single });
  // 最近一次写入背景输入框的采样值，用于判断输入是否已被手工改动。
  const [pickedHex, setPickedHex] = useState<string | null>(null);

  // 仅在内存中持有本地图片（ObjectURL），不写入任何持久化存储，刷新即清空。
  useEffect(() => {
    return () => {
      if (imageRef.current) {
        URL.revokeObjectURL(imageRef.current.src);
      }
    };
  }, []);

  // 页面完成核验后，本次采样即已提交，恢复普通提示。
  useEffect(() => {
    if (committedNonce > 0 && imageRef.current) {
      setPickedHex(null);
      setStatus({ kind: 'info', text: LOADED_TEXT[modeRef.current] });
    }
  }, [committedNonce]);

  // 画布按图片原始像素尺寸建立后备存储，显示缩放交给 CSS。
  useEffect(() => {
    if (!image) {
      return;
    }
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img) {
      return;
    }
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (ctx) {
      ctx.drawImage(img, 0, 0);
    }
  }, [image]);

  // 切换“单点 / 区域平均”：默认且随时可切回单点；不改动背景输入与已显示结果，
  // 只在取色区说明当前方式下后续点击的含义。已有错误或“尚未提交”提示保持原样。
  function handleModeChange(next: SampleMode) {
    modeRef.current = next;
    setMode(next);
    setStatus((prev) =>
      prev.kind === 'idle' || prev.kind === 'info'
        ? { kind: prev.kind, text: imageRef.current ? LOADED_TEXT[next] : IDLE_TEXT[next] }
        : prev,
    );
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // 立即清空 input，使同一文件可以被再次选择。
    event.target.value = '';
    if (!file) {
      return;
    }
    // 非图片文件：在取色区说明原因，保留当前背景输入与上一份结果。
    const notImageText = `“${file.name}”不是图片文件，请选择 PNG、JPG 等图片；当前底色输入未改动。`;
    // 空串与 application/octet-stream 都表示“类型未知”，需按内容嗅探，不能仅凭类型下结论。
    const typeUnknown = file.type === '' || file.type === 'application/octet-stream';
    if (!typeUnknown && !file.type.startsWith('image/')) {
      setStatus({ kind: 'error', text: notImageText });
      return;
    }
    const loadId = ++loadIdRef.current;
    // 文件未携带可用的类型信息时，按文件头魔数兜底识别，
    // 避免纯文本等文件走到解码阶段被误报为“解码失败”。
    if (typeUnknown) {
      let looksLikeImage = false;
      try {
        looksLikeImage = hasKnownImageSignature(
          new Uint8Array(await file.slice(0, 16).arrayBuffer()),
        );
      } catch {
        looksLikeImage = false;
      }
      // 读取文件头期间又选择了更新的文件时，放弃这次迟到的判断。
      if (loadId !== loadIdRef.current) {
        return;
      }
      if (!looksLikeImage) {
        setStatus({ kind: 'error', text: notImageText });
        return;
      }
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      // 又选择了更新的文件时，放弃这次迟到的载入。
      if (loadId !== loadIdRef.current) {
        URL.revokeObjectURL(url);
        return;
      }
      const previous = imageRef.current;
      imageRef.current = img;
      setImage({ naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight });
      setPickedHex(null);
      setStatus({ kind: 'info', text: LOADED_TEXT[modeRef.current] });
      if (previous) {
        URL.revokeObjectURL(previous.src);
      }
    };
    img.onerror = () => {
      // 解码失败同样只在取色区提示，不清空已载入的图片、背景输入与结果。
      if (loadId === loadIdRef.current) {
        setStatus({
          kind: 'error',
          text: `“${file.name}”解码失败，请换一张能正常打开的图片；当前底色输入未改动。`,
        });
      }
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }

  function handleCanvasClick(event: MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas || !image) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    // 图片只绘制在内容盒内：用 clientLeft/clientTop 去掉装饰边框、
    // 以 clientWidth/clientHeight 为显示尺寸，落在边框上的点击即判为图片区域外。
    const pixel = mapDisplayPointToImagePixel(
      {
        x: event.clientX - rect.left - canvas.clientLeft,
        y: event.clientY - rect.top - canvas.clientTop,
      },
      {
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        displayWidth: canvas.clientWidth,
        displayHeight: canvas.clientHeight,
      },
    );
    if (!pixel) {
      setStatus({
        kind: 'error',
        text: '点击位置在画布边界外（含装饰边框），未取色；请点击图片区域内的像素。当前底色输入未改动。',
      });
      return;
    }
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      setStatus({ kind: 'error', text: '画布不可读，未能取色；当前底色输入未改动。' });
      return;
    }

    // 区域平均：一次性读取整幅像素数据交给领域函数做 3×3 平均，
    // 画布层不自行实现任何平均/裁剪算法。
    if (modeRef.current === 'average') {
      let imageData: ImageData;
      try {
        imageData = ctx.getImageData(0, 0, image.naturalWidth, image.naturalHeight);
      } catch {
        // 区域读取失败：只在取色区说明原因，背景输入与已显示结果保持原样。
        setStatus({ kind: 'error', text: '读取该区域失败，未能取色；当前底色输入未改动。' });
        return;
      }
      const average = averageNeighborhood(
        imageData.data,
        { naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight },
        pixel,
      );
      if (!average) {
        // 有效像素为空等无法平均的情形：同样不改值。
        setStatus({ kind: 'error', text: '区域内没有可平均的有效像素，未能取色；当前底色输入未改动。' });
        return;
      }
      const hex = average.hex;
      onPick(hex);
      setPickedHex(hex);
      setStatus({
        kind: 'success',
        text: `已按 3×3 区域平均取色 ${hex}（计入 ${average.count} 个像素）并写入背景用色输入框；本次采样尚未提交，请点击“核验”。`,
      });
      return;
    }

    let channels: Uint8ClampedArray;
    try {
      channels = ctx.getImageData(pixel.x, pixel.y, 1, 1).data;
    } catch {
      setStatus({ kind: 'error', text: '读取该像素失败，未能取色；当前底色输入未改动。' });
      return;
    }
    // 只取 R/G/B：结果一律是不透明六位色值，与 alpha 无关。
    const hex = rgbChannelsToHex(channels[0], channels[1], channels[2]);
    onPick(hex);
    setPickedHex(hex);
    setStatus({
      kind: 'success',
      text: `已取色 ${hex} 并写入背景用色输入框；本次采样尚未提交，请点击“核验”。`,
    });
  }

  // 采样提示只在背景输入仍等于采样值时成立；设计师手工改成其他色值后，
  // 取色区回到普通提示，状态始终与当前背景输入一致。
  const displayedStatus: PickerStatus =
    status.kind === 'success' &&
    pickedHex !== null &&
    backgroundValue.trim().toUpperCase() !== pickedHex
      ? { kind: 'info', text: LOADED_TEXT[mode] }
      : status;

  return (
    <section className="panel picker" aria-labelledby="picker-title">
      <h2 id="picker-title">从本地图片采样底色</h2>
      <div className="field">
        <label htmlFor="image-file">本地图片（仅在本页内存中使用，刷新不保留）</label>
        <input
          id="image-file"
          data-testid="image-file"
          type="file"
          accept="image/*"
          onChange={handleFileChange}
        />
      </div>

      <fieldset className="field sample-mode">
        <legend>取色方式</legend>
        <label>
          <input
            type="radio"
            name="sample-mode"
            value="single"
            data-testid="sample-mode-single"
            checked={mode === 'single'}
            onChange={() => handleModeChange('single')}
          />
          单点
        </label>
        <label>
          <input
            type="radio"
            name="sample-mode"
            value="average"
            data-testid="sample-mode-average"
            checked={mode === 'average'}
            onChange={() => handleModeChange('average')}
          />
          区域平均（点击像素周围 3×3）
        </label>
      </fieldset>

      {image ? (
        <canvas
          ref={canvasRef}
          className="sample-canvas"
          data-testid="sample-canvas"
          onClick={handleCanvasClick}
          role="img"
          aria-label={
            mode === 'average'
              ? '点击图片像素采样周围 3×3 区域平均底色'
              : '点击图片像素采样底色'
          }
        />
      ) : (
        <div className="picker-placeholder" data-testid="picker-placeholder">
          尚未载入图片
        </div>
      )}

      <p
        className={`picker-status${displayedStatus.kind === 'idle' || displayedStatus.kind === 'info' ? '' : ` ${displayedStatus.kind}`}`}
        data-testid="picker-status"
        role="status"
      >
        {displayedStatus.text}
      </p>
    </section>
  );
}
