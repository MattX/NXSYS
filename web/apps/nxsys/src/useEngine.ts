import { useSyncExternalStore } from "react";
import { engine, type Snapshot } from "./engine";

export function useEngine(): Snapshot {
  return useSyncExternalStore(engine.subscribe, engine.getSnapshot);
}
