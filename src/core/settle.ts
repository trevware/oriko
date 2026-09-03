/** The two timer calls settled() needs, so the host is a parameter: the
    view passes its window; a test passes node's. */
export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

/**
 * Runs `fn` once the calls stop coming for `ms`.
 *
 * For work that is only worth doing at the end of a burst: laying the wall
 * out for a pane whose width is mid-animation would be redone next frame,
 * and on a wall of video tiles each pass rewrites every visible tile's size
 * and re-rasterizes its frame, which is what a sidebar toggle was spending
 * its whole animation on.
 */
export function settled(
  fn: () => void,
  ms: number,
  timers: Timers
): { call: () => void; cancel: () => void } {
  let timer: unknown = null;
  const cancel = (): void => {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
  };
  return {
    call: () => {
      cancel();
      timer = timers.setTimeout(() => {
        timer = null;
        fn();
      }, ms);
    },
    cancel,
  };
}
