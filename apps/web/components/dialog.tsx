"use client";

import { useEffect, useRef } from "react";

type DialogProps = {
  title: string;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
};

export function Dialog({ title, open, onClose, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="dialog-title"
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-lg border border-rule bg-card p-0 text-ink shadow-xl"
    >
      <div className="flex items-center justify-between border-b border-rule px-5 py-3">
        <h2 id="dialog-title" className="text-sm font-semibold">
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="text-soft hover:text-ink"
        >
          ✕
        </button>
      </div>
      <div className="p-5">{open && children}</div>
    </dialog>
  );
}
