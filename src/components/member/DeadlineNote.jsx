"use client";

// ============================================================================
// DeadlineNote — a hydration-safe "the payment window is still open" note.
//
// The parent order page is a SERVER component and cannot call Date.now() during
// render: the server and the browser evaluate it a few hundred milliseconds
// apart, so "deadline is in the future" can flip between the two and React logs
// a hydration mismatch. This client component renders nothing on the first
// pass and settles the comparison in an effect, so the server HTML and the
// first client paint always agree.
// ============================================================================
import { useEffect, useState } from "react";
import { formatDateTime } from "@/lib/format.js";

export default function DeadlineNote({ deadline, expiresAt }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!deadline) return;
    setOpen(new Date(deadline).getTime() > Date.now());
  }, [deadline]);

  if (!open) return null;

  return (
    <p className="mt-4 text-xs text-foreground-subtle">
      Batas pembayaran: {formatDateTime(expiresAt ?? deadline)}
    </p>
  );
}
