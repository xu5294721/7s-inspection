type ProcessingListener = () => void;

export interface PhotoProcessingActivity {
  release(): void;
}

const activities = new Set<symbol>();
const listeners = new Set<ProcessingListener>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

export function beginPhotoProcessing(): PhotoProcessingActivity {
  const token = Symbol("photo-processing");
  const wasIdle = activities.size === 0;
  activities.add(token);
  if (wasIdle) notify();

  return {
    release() {
      if (!activities.delete(token)) return;
      if (activities.size === 0) notify();
    },
  };
}

export function getPhotoProcessing(): boolean {
  return activities.size > 0;
}

export function subscribePhotoProcessing(listener: ProcessingListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
