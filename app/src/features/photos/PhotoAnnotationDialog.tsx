import {
  ArrowUpRight,
  Circle,
  Eraser,
  Save,
  Type,
  Undo2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import {
  parseAnnotationJson,
  serializeAnnotationShapes,
  type AnnotationShape,
} from "../../domain/inspection";
import type { PhotoAsset } from "../../domain/models";

interface PhotoAnnotationDialogProps {
  photo: PhotoAsset;
  onCancel(): void;
  onSave(annotationJson: string | null): Promise<void>;
}

type AnnotationTool = "ellipse" | "arrow" | "text";

interface Point {
  x: number;
  y: number;
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function pointFromEvent(event: PointerEvent<HTMLCanvasElement>): Point {
  const bounds = event.currentTarget.getBoundingClientRect();
  return {
    x: clamp((event.clientX - bounds.left) / Math.max(bounds.width, 1)),
    y: clamp((event.clientY - bounds.top) / Math.max(bounds.height, 1)),
  };
}

function drawShapes(
  context: CanvasRenderingContext2D,
  shapes: AnnotationShape[],
  width: number,
  height: number,
): void {
  context.lineWidth = Math.max(4, Math.min(width, height) * 0.008);
  context.font = `${Math.max(24, Math.round(Math.min(width, height) * 0.045))}px Microsoft YaHei`;
  for (const shape of shapes) {
    context.strokeStyle = shape.color;
    context.fillStyle = shape.color;
    if (shape.type === "ellipse") {
      context.beginPath();
      context.ellipse(
        (shape.x + shape.width / 2) * width,
        (shape.y + shape.height / 2) * height,
        (shape.width * width) / 2,
        (shape.height * height) / 2,
        0,
        0,
        Math.PI * 2,
      );
      context.stroke();
    } else if (shape.type === "arrow") {
      const [startX, startY, endX, endY] = shape.points;
      context.beginPath();
      context.moveTo(startX * width, startY * height);
      context.lineTo(endX * width, endY * height);
      context.stroke();
    } else {
      context.fillText(shape.text, shape.x * width, shape.y * height);
    }
  }
}

export function PhotoAnnotationDialog({ photo, onCancel, onSave }: PhotoAnnotationDialogProps) {
  const [shapes, setShapes] = useState<AnnotationShape[]>(() =>
    parseAnnotationJson(photo.annotationJson));
  const [tool, setTool] = useState<AnnotationTool>("ellipse");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const startPoint = useRef<Point | null>(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    cancelButtonRef.current?.focus();

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancelRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const objectUrl = URL.createObjectURL(photo.imageBlob);
    const image = new Image();
    image.onload = () => {
      const context = canvas.getContext("2d");
      if (!context) return;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      drawShapes(context, shapes, canvas.width, canvas.height);
    };
    image.src = objectUrl;
    return () => URL.revokeObjectURL(objectUrl);
  }, [photo.imageBlob, shapes]);

  function beginShape(event: PointerEvent<HTMLCanvasElement>) {
    const point = pointFromEvent(event);
    if (tool === "text") {
      if (text.trim()) {
        setShapes((current) => [...current, {
          type: "text",
          x: point.x,
          y: point.y,
          text: text.trim(),
          color: "#d12f2f",
        }]);
      }
      return;
    }
    startPoint.current = point;
  }

  function finishShape(event: PointerEvent<HTMLCanvasElement>) {
    const start = startPoint.current;
    startPoint.current = null;
    if (!start || tool === "text") return;
    const end = pointFromEvent(event);
    if (tool === "arrow") {
      setShapes((current) => [...current, {
        type: "arrow",
        points: [start.x, start.y, end.x, end.y],
        color: "#d12f2f",
      }]);
      return;
    }
    setShapes((current) => [...current, {
      type: "ellipse",
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
      color: "#d12f2f",
    }]);
  }

  async function saveAnnotation() {
    setSaving(true);
    setSaveError("");
    try {
      await onSave(serializeAnnotationShapes(shapes));
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "照片标注保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="annotation-backdrop" role="presentation">
      <section ref={dialogRef} className="annotation-dialog" role="dialog" aria-modal="true" aria-label="照片标注">
        <header className="annotation-dialog__header">
          <strong>照片标注</strong>
          <button ref={cancelButtonRef} type="button" aria-label="取消标注" onClick={onCancel}>
            <X aria-hidden="true" size={20} />
          </button>
        </header>
        <div className="annotation-toolbar" aria-label="标注工具">
          <button type="button" aria-label="椭圆工具" aria-pressed={tool === "ellipse"} onClick={() => setTool("ellipse")}>
            <Circle aria-hidden="true" size={20} />
          </button>
          <button type="button" aria-label="箭头工具" aria-pressed={tool === "arrow"} onClick={() => setTool("arrow")}>
            <ArrowUpRight aria-hidden="true" size={20} />
          </button>
          <button type="button" aria-label="文字工具" aria-pressed={tool === "text"} onClick={() => setTool("text")}>
            <Type aria-hidden="true" size={20} />
          </button>
          <button type="button" aria-label="撤销标注" disabled={shapes.length === 0} onClick={() => setShapes((current) => current.slice(0, -1))}>
            <Undo2 aria-hidden="true" size={20} />
          </button>
          <button type="button" aria-label="清空标注" disabled={shapes.length === 0} onClick={() => setShapes([])}>
            <Eraser aria-hidden="true" size={20} />
          </button>
        </div>
        {tool === "text" ? (
          <label className="annotation-text-input">
            <span>标注文字</span>
            <input aria-label="标注文字" value={text} onChange={(event) => setText(event.currentTarget.value)} />
          </label>
        ) : null}
        <canvas
          ref={canvasRef}
          className="annotation-canvas"
          width={Math.max(1, photo.width)}
          height={Math.max(1, photo.height)}
          aria-label="照片标注画布"
          onPointerDown={beginShape}
          onPointerUp={finishShape}
        />
        <footer className="annotation-dialog__footer">
          <span>{shapes.length}个标注</span>
          <button type="button" disabled={saving} onClick={() => void saveAnnotation()}>
            <Save aria-hidden="true" size={18} />
            保存标注
          </button>
        </footer>
        {saveError ? <p className="inline-error" role="alert">{saveError}</p> : null}
      </section>
    </div>
  );
}
