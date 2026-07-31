import { Camera, Images } from "lucide-react";
import { useRef, type ChangeEvent } from "react";

interface PhotoCaptureButtonsProps {
  onFilesSelected(files: File[]): void;
  disabled?: boolean;
}

export function PhotoCaptureButtons({
  onFilesSelected,
  disabled = false,
}: PhotoCaptureButtonsProps) {
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);

  function selectFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (files.length > 0) onFilesSelected(files);
  }

  return (
    <div className="photo-capture-buttons">
      <button type="button" disabled={disabled} onClick={() => cameraInput.current?.click()}>
        <Camera aria-hidden="true" size={18} />
        拍照
      </button>
      <input
        ref={cameraInput}
        className="sr-only"
        type="file"
        accept="image/*"
        capture="environment"
        aria-label="拍照文件"
        onChange={selectFiles}
      />
      <button type="button" disabled={disabled} onClick={() => galleryInput.current?.click()}>
        <Images aria-hidden="true" size={18} />
        从相册选择
      </button>
      <input
        ref={galleryInput}
        className="sr-only"
        type="file"
        accept="image/*"
        multiple
        aria-label="相册文件"
        onChange={selectFiles}
      />
    </div>
  );
}
