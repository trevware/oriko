/**
 * Runs `fn` once the calls stop coming for `ms`.
 *
 * For work that is only worth doing at the end of a burst: laying the wall
 * out for a pane whose width is mid-animation would be redone next frame,
 * and on a wall of video tiles each pass rewrites every visible tile's size
 * and re-rasterizes its frame, which is what a sidebar toggle was spending
 * its whole animation on.
 */
export function settled(fn: () => void, ms: number): { call: () => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cancel = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  return {
    call: () => {
      cancel();
      timer = setTimeout(() => {
        timer = null;
        fn();
      }, ms);
    },
    cancel,
  };
}
