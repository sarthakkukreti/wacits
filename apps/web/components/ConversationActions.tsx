"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setConversationStateAction } from "../app/inbox/actions";

/** Open/close toggle for a conversation. §14: exactly two states — there is
 *  no "snoozed" in this product, deliberately. */
export function ConversationActions({ conversationId, state }: { conversationId: string; state: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const toggle = () => {
    startTransition(async () => {
      await setConversationStateAction(conversationId, state === "open" ? "closed" : "open");
      router.refresh();
    });
  };

  return (
    <button type="button" className="btn btn-sm" onClick={toggle} disabled={pending}>
      {pending ? <span className="spinner" /> : state === "open" ? "Close" : "Reopen"}
    </button>
  );
}
