import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  getPhotoProcessing,
  subscribePhotoProcessing,
} from "./photoProcessingSignal";

interface PwaUpdatePromptProps {
  needRefresh: boolean;
  updateServiceWorker: (reloadPage?: boolean) => Promise<void>;
}

export function PwaUpdatePrompt({
  needRefresh,
  updateServiceWorker,
}: PwaUpdatePromptProps) {
  const processing = useSyncExternalStore(
    subscribePhotoProcessing,
    getPhotoProcessing,
    () => false,
  );
  const [pending, setPending] = useState(false);

  const update = useCallback((): void => {
    void updateServiceWorker(true).catch(() => undefined);
  }, [updateServiceWorker]);

  useEffect(() => {
    if (!pending || processing) return;
    setPending(false);
    update();
  }, [pending, processing, update]);

  if (!needRefresh) return null;

  return (
    <aside className="pwa-update-bar" role="status" aria-live="polite">
      <span>发现新版本</span>
      {pending ? <small>照片处理完成后更新</small> : null}
      <button type="button" disabled={pending} onClick={() => {
        if (processing) setPending(true);
        else update();
      }}>
        立即更新
      </button>
    </aside>
  );
}
