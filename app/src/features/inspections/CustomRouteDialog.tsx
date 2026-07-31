import { useEffect, useRef, useState, type RefObject } from "react";

interface CustomRouteDialogProps {
  openerRef: RefObject<HTMLElement | null>;
  title?: string;
  fieldLabel?: string;
  onCancel(): void;
  onSave(name: string): Promise<void>;
}

export function CustomRouteDialog({
  openerRef,
  title = "增加自定义检查项目",
  fieldLabel = "检查项目名称",
  onCancel,
  onSave,
}: CustomRouteDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const isSavingRef = useRef(false);
  const onCancelRef = useRef(onCancel);
  isSavingRef.current = isSaving;
  onCancelRef.current = onCancel;
  const trimmedName = name.trim();

  useEffect(() => {
    const opener = openerRef.current;
    inputRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isSavingRef.current) {
        event.preventDefault();
        onCancelRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      )).sort((left, right) => {
        if (left === right) return 0;
        return left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
      });
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
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
      opener?.focus();
    };
  }, [openerRef]);

  useEffect(() => {
    if (!isSaving && error) inputRef.current?.focus();
  }, [error, isSaving]);

  async function save() {
    if (!trimmedName || isSaving) return;
    setError("");
    setIsSaving(true);
    try {
      await onSave(trimmedName);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败，请重试。");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="confirmation-backdrop" role="presentation">
      <section ref={dialogRef} className="confirmation-dialog custom-route-dialog" role="dialog" aria-modal="true" aria-busy={isSaving} aria-labelledby="custom-route-dialog-title" tabIndex={-1}>
        <h3 id="custom-route-dialog-title">{title}</h3>
        {error ? <p className="inline-error" role="alert">{error}</p> : null}
        <label className="custom-route-dialog__field">
          {fieldLabel}
          <input
            ref={inputRef}
            aria-label={fieldLabel}
            disabled={isSaving}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <div>
          <button type="button" disabled={isSaving} onClick={onCancel}>取消</button>
          <button type="button" className="primary-action" disabled={!trimmedName || isSaving} onClick={() => void save()}>
            {isSaving ? "正在保存" : "保存"}
          </button>
        </div>
      </section>
    </div>
  );
}
