"use client";
import { copy } from "@/lib/i18n";
import { Button, Empty } from "@/components/ui";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="card">
      <Empty
        title={copy.errors.boundary}
        description={copy.errors.boundaryDetail}
      />
      <div className="center-action">
        <Button onClick={reset}>{copy.common.retry}</Button>
      </div>
    </div>
  );
}
