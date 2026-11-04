import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { imageURL, type ChatImage } from "../../shared/images";
import "../images.css";

function ImageTile({
  image,
  onOpen,
}: {
  image: ChatImage;
  onOpen: () => void;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <button
      type="button"
      className="chat-image-open"
      onClick={onOpen}
      disabled={failed}
      aria-label={`Xem ảnh ${image.name}`}
    >
      {failed ? (
        <span>Không đọc được ảnh</span>
      ) : (
        <img
          src={imageURL(image)}
          alt={image.name}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      )}
      <span className="chat-image-name" title={image.name}>
        {image.name}
      </span>
    </button>
  );
}

export function ChatImages({
  images,
  onRemove,
  disabled,
}: {
  images: ChatImage[];
  onRemove?: (image: ChatImage) => void;
  disabled?: boolean;
}) {
  const [preview, setPreview] = useState<ChatImage | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (preview) dialog.current?.showModal();
  }, [preview]);
  if (!images.length) return null;
  return (
    <>
      <div className="chat-images" aria-label="Ảnh đính kèm">
        {images.map((image) => (
          <div className="chat-image-tile" key={image.id}>
            <ImageTile image={image} onOpen={() => setPreview(image)} />
            {onRemove && (
              <button
                type="button"
                className="chat-image-remove icon-button"
                aria-label={`Bỏ ảnh ${image.name}`}
                disabled={disabled}
                onClick={() => onRemove(image)}
              >
                <X size={13} />
              </button>
            )}
          </div>
        ))}
      </div>
      {preview && (
        <dialog
          ref={dialog}
          className="chat-image-preview"
          aria-label={`Ảnh ${preview.name}`}
          onCancel={() => setPreview(null)}
        >
          <div>
            <span>{preview.name}</span>
            <button
              type="button"
              autoFocus
              className="icon-button"
              aria-label="Đóng ảnh"
              onClick={() => setPreview(null)}
            >
              <X size={18} />
            </button>
          </div>
          <img src={imageURL(preview)} alt={preview.name} />
          <small>
            {preview.width} × {preview.height} ·{" "}
            {Math.ceil(preview.bytes / 1024)} KB
          </small>
        </dialog>
      )}
    </>
  );
}
