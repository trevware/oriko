/**
 * Scrolls a list to show one of its rows, and scrolls only the list.
 *
 * scrollIntoView walks up and scrolls every scrollable ancestor on the way,
 * and the wall's viewport is one of them even at overflow: hidden, which is
 * programmatically scrollable all the same. The wall reads its viewport's
 * scroll as a camera move, so a row scrolled into view from a sheet, a menu
 * or the palette dragged the wall behind it. One helper for all three.
 */
export function scrollRowIntoList(list: HTMLElement | null, row: HTMLElement | undefined): void {
  if (!list || !row) return;
  const top = row.offsetTop;
  const bottom = top + row.offsetHeight;
  if (top < list.scrollTop) list.scrollTop = top;
  else if (bottom > list.scrollTop + list.clientHeight) {
    list.scrollTop = bottom - list.clientHeight;
  }
}
