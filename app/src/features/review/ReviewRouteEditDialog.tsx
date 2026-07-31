import type { ReactNode } from "react";

interface ReviewRouteEditDialogProps {
  routeName: string;
  children: ReactNode;
  onClose(): void;
}

export function ReviewRouteEditDialog({ routeName, children, onClose }: ReviewRouteEditDialogProps) {
  return (
    <div className="review-route-dialog-backdrop">
      <section className="review-route-edit-dialog" role="dialog" aria-modal="true" aria-label={`编辑 ${routeName}`}>
        <header className="review-route-dialog__header"><h3>编辑 {routeName}</h3></header>
        <div className="review-route-edit-dialog__body">{children}</div>
        <footer className="review-route-dialog__command">
          <button type="button" className="primary-action" onClick={onClose}>关闭</button>
        </footer>
      </section>
    </div>
  );
}
