import * as React from "react";
import { cn } from "@/lib/utils";

function Progress({
  value = 0,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  value?: number;
}) {
  return (
    <div
      data-slot="progress"
      className={cn("relative h-2 w-full overflow-hidden rounded-full bg-secondary", className)}
      {...props}
    >
      <div
        data-slot="progress-indicator"
        className="h-full w-full flex-1 bg-primary transition-transform"
        style={{ transform: `translateX(-${100 - Math.max(0, Math.min(100, value))}%)` }}
      />
    </div>
  );
}

export { Progress };
