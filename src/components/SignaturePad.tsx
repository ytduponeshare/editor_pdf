import { useEffect, useRef } from 'react';

interface SignaturePadProps {
  value?: string;
  invalid?: boolean;
  onChange: (value?: string) => void;
}

export function SignaturePad({ value, invalid, onChange }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const hasInkRef = useRef(!!value);

  const prepareCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rect.width * ratio));
    const height = Math.max(1, Math.round(rect.height * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.lineWidth = 2;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = '#111827';
    return { canvas, context, rect };
  };

  useEffect(() => {
    const prepared = prepareCanvas();
    if (!prepared) return;
    prepared.context.clearRect(0, 0, prepared.rect.width, prepared.rect.height);
    hasInkRef.current = !!value;
    if (!value) return;
    const image = new Image();
    image.onload = () => prepared.context.drawImage(image, 0, 0, prepared.rect.width, prepared.rect.height);
    image.src = value;
  }, [value]);

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const start = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const prepared = prepareCanvas();
    if (!prepared) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const current = point(event);
    prepared.context.beginPath();
    prepared.context.moveTo(current.x, current.y);
    prepared.context.lineTo(current.x + 0.1, current.y + 0.1);
    prepared.context.stroke();
    drawingRef.current = true;
    hasInkRef.current = true;
  };

  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    event.preventDefault();
    const context = event.currentTarget.getContext('2d');
    if (!context) return;
    const current = point(event);
    context.lineTo(current.x, current.y);
    context.stroke();
  };

  const end = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (hasInkRef.current) onChange(event.currentTarget.toDataURL('image/png'));
  };

  const clear = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const prepared = prepareCanvas();
    if (prepared) prepared.context.clearRect(0, 0, prepared.rect.width, prepared.rect.height);
    hasInkRef.current = false;
    onChange(undefined);
  };

  return (
    <div className={`signature-pad${invalid ? ' is-invalid' : ''}`}>
      <canvas
        ref={canvasRef}
        aria-label="手写签名区"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      />
      <button type="button" onClick={clear}>清空</button>
    </div>
  );
}
