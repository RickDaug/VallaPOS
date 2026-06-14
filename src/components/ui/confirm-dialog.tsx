"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style the confirm button as destructive (default true — most confirms are deletes). */
  destructive?: boolean;
}

type PendingConfirm = ConfirmOptions & { resolve: (ok: boolean) => void };

/**
 * Promise-based confirm dialog. Returns `[confirm, element]`:
 * render `element` once, then `await confirm({ title, … })` resolves to
 * `true`/`false`. Replaces `window.confirm` with a styled, accessible modal.
 */
export function useConfirm(): [(opts: ConfirmOptions) => Promise<boolean>, React.ReactNode] {
  const [pending, setPending] = React.useState<PendingConfirm | null>(null);

  const confirm = React.useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setPending({ ...opts, resolve });
      }),
    [],
  );

  // Resolve to the given answer, then close.
  const settle = React.useCallback(
    (ok: boolean) => {
      setPending((p) => {
        p?.resolve(ok);
        return null;
      });
    },
    [],
  );

  const element = (
    <Dialog
      open={pending !== null}
      onOpenChange={(open) => {
        // Closing via escape / overlay / X counts as cancel.
        if (!open) settle(false);
      }}
    >
      {pending && (
        <DialogContent showClose={false}>
          <DialogHeader>
            <DialogTitle>{pending.title}</DialogTitle>
            {pending.description && <DialogDescription>{pending.description}</DialogDescription>}
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => settle(false)}>
              {pending.cancelLabel ?? "Cancel"}
            </Button>
            <Button
              variant={pending.destructive === false ? "primary" : "destructive"}
              size="sm"
              autoFocus
              onClick={() => settle(true)}
            >
              {pending.confirmLabel ?? "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );

  return [confirm, element];
}
