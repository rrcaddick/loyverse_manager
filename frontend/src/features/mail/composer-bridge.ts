/**
 * A tiny bridge so something outside the ConversationView (the Mail page's
 * context panel) can open the docked composer or drop a document into it.
 *
 *   const bridge = useComposerBridge();
 *   <ConversationView thrid={thrid} bridge={bridge} />
 *   <BookingContextPanel … onAttachDocument={(id) => bridge.attachDocument(id)} />
 */

import { useState } from "react";

import type { ComposerMode } from "./lib";

export interface ComposerBridgeHandlers {
  open: (mode: ComposerMode) => void;
  attachDocument: (documentId: number) => void;
}

export interface ComposerBridge {
  open: (mode: ComposerMode) => void;
  attachDocument: (documentId: number) => void;
  /** Called by the ConversationView while mounted. */
  register: (handlers: ComposerBridgeHandlers | null) => void;
}

export function createComposerBridge(): ComposerBridge {
  let current: ComposerBridgeHandlers | null = null;
  return {
    open: (mode) => current?.open(mode),
    attachDocument: (id) => current?.attachDocument(id),
    register: (handlers) => {
      current = handlers;
    },
  };
}

export function useComposerBridge(): ComposerBridge {
  const [bridge] = useState(createComposerBridge);
  return bridge;
}
