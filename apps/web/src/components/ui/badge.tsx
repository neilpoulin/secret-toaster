import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "text-foreground",
        boardLand: "border-[var(--board-land-stroke)] bg-[var(--board-land-fill)] text-[var(--board-text)]",
        boardKeep: "border-[var(--board-keep-stroke)] bg-[var(--board-keep-fill)] text-[var(--board-text)]",
        boardCastle: "border-[var(--board-castle-stroke)] bg-[var(--board-castle-fill)] text-[var(--board-text)]",
        boardBlank: "border-[var(--board-blank-stroke)] bg-[var(--board-blank-fill)] text-[var(--board-text-muted)]",
        boardStateActive:
          "border-[var(--board-state-active-stroke)] bg-[var(--board-state-active-fill)] text-[var(--board-text)]",
        boardStateNeighbor:
          "border-[var(--board-state-neighbor-stroke)] bg-[var(--board-state-neighbor-fill)] text-[var(--board-text)]",
        boardStateSelected:
          "border-[var(--board-state-selected-stroke)] bg-[var(--board-state-selected-fill)] text-[var(--board-text)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({ className, variant, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
