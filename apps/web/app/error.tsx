"use client";

import { Notice } from "../components/Notice";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="content">
      <Notice title="Something went wrong">{error.message || "An unexpected error occurred."}</Notice>
      <button type="button" className="btn btn-primary mt-16" onClick={() => reset()}>
        Try again
      </button>
    </div>
  );
}
