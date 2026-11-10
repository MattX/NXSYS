/** Keep floating windows' title bars reachable: never above the bottom of the (possibly wrapped) toolbar. */
export function minWindowTop(): number {
  try {
    const bar = document.querySelector(".toolbar");
    return bar ? Math.ceil(bar.getBoundingClientRect().bottom) + 4 : 48;
  } catch {
    return 48;
  }
}

export function clampWindowTop(y: number): number {
  return Math.max(minWindowTop(), y);
}
