import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent,
} from 'react';
import { mapDisplayPointToImagePixel, rgbChannelsToHex } from '../lib/sample';

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
}

export default function ColorPicker({ onPick, committedNonce }: ColorPickerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const loadIdRef = useRef(0);
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [status, setStatus] = useState<PickerStatus>({ kind: 'idle', text: IDLE_TEXT });

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

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // 立即清空 input，使同一文件可以被再次选择。
    event.target.value = '';
    if (!file) {
      return;
    }
    // 非图片文件：在取色区说明原因，保留当前背景输入与上一份结果。
    if (file.type && !file.type.startsWith('image/')) {
      setStatus({
        kind: 'error',
        text: `“${file.name}”不是图片文件，请选择 PNG、JPG 等图片；当前底色输入未改动。`,
      });
      return;
    }
    const url = URL.createObjectURL(file);
    const loadId = ++loadIdRef.current;
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
    const pixel = mapDisplayPointToImagePixel(
      { x: event.clientX - rect.left, y: event.clientY - rect.top },
      {
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        displayWidth: rect.width,
        displayHeight: rect.height,
      },
    );
    if (!pixel) {
      setStatus({
        kind: 'error',
        text: '点击位置在画布边界外，未取色；请点击图片区域内的像素。当前底色输入未改动。',
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
    setStatus({
      kind: 'success',
      text: `已取色 ${hex} 并写入背景用色输入框；本次采样尚未提交，请点击“核验”。`,
    });
  }

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
        className={`picker-status${status.kind === 'idle' || status.kind === 'info' ? '' : ` ${status.kind}`}`}
        data-testid="picker-status"
        role="status"
      >
        {status.text}
      </p>
    </section>
  );
}
