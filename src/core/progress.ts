/** What a clip in progress is doing, as its card on the wall shows it. */
export interface ProgressState {
  /** 0..1, or null for work whose length is unknown. */
  fraction: number | null;
  label: string;
}
