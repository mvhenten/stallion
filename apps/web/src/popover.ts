import type { RefObject } from "preact";
import { useLayoutEffect, useState } from "preact/hooks";
import { type Placement, placePopover } from "./toolbar-layout";

export const usePlacement = (
  open: boolean,
  anchorRef: RefObject<HTMLElement>,
  desiredHeight: number,
): Placement | undefined => {
  const [placement, setPlacement] = useState<Placement | undefined>(undefined);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      setPlacement(placePopover(anchor.getBoundingClientRect(), window.innerHeight, desiredHeight));
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open, anchorRef, desiredHeight]);

  return open ? placement : undefined;
};

export const placementStyle = (placement: Placement | undefined) =>
  placement ? { maxHeight: `${placement.maxHeight}px` } : { visibility: "hidden" as const };
