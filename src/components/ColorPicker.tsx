import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent,
} from 'react';
import { mapDisplayPointToImagePixel, hasKnownImageSignature, rgbChannelsToHex } from '../lib/sample';

const IDLE_TEXT = '选择展墙照片或纹理底图，载入后点击画布中的像素取色；采样仅写入背景用色输入框，不会自行提交。';
const LOADED_TEXT = '图片已载入：点击画布中的像素取色，采样按图片原始尺寸换算。';

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
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [status, setStatus] = useState<PickerStatus>({ kind: 'idle', text: IDLE_TEXT });
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
      setStatus({ kind: 'info', text: LOADED_TEXT });
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
      setStatus({ kind: 'info', text: LOADED_TEXT });
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
      ? { kind: 'info', text: LOADED_TEXT }
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

      {image ? (
        <canvas
          ref={canvasRef}
          className="sample-canvas"
          data-testid="sample-canvas"
          onClick={handleCanvasClick}
          role="img"
          aria-label="点击图片像素采样底色"
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
