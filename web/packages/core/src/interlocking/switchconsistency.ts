/*
 * Switch A/B/singleton consistency checks — port of NXSYS/v2/SwitchConsistency.cpp.
 * Each function returns a complaint string, or null when all is well.
 */

const ID_SINGLETON = 4;
let switchMap = new Map<number, number>(); // C++ std::map<long,int>: iterate in key order

function massageTag(AB0: number): number {
  return AB0 === 0 ? ID_SINGLETON : AB0;
}

export function switchConsistencyClear(): void {
  switchMap = new Map();
}

export function switchConsistencyUndefine(ID: number, AB0: number): void {
  const cur = switchMap.get(ID);
  if (cur === undefined) return; // not found -- shouldn't really happen.
  const tag = massageTag(AB0);
  let current = cur;
  if (current === 0) {
    switchMap.delete(ID);
    return;
  }
  if (tag === current) {
    switchMap.delete(ID);
    return;
  }
  if ((current & AB0) !== 0) {
    current = current ^ AB0;
    if (current === 0) switchMap.delete(ID);
    else switchMap.set(ID, current);
  }
}

export function switchConsistencyDefineCheck(ID: number, AB0: number): string | null {
  const current = switchMap.get(ID);
  if (current === undefined) return null; // terrific!
  if (current === 0) return null;
  const tag = massageTag(AB0);
  let descrip: string;
  switch (tag) {
    case ID_SINGLETON:
      descrip = "singleton";
      break;
    case 1:
      descrip = "A";
      break;
    case 2:
      descrip = "B";
      break;
    default:
      descrip = "??";
      break;
  }
  if ((current & tag) !== 0) return `Switch ${ID} ${descrip} is already defined elsewhere.`;
  if ((current | tag) === 3) return null; // ideal
  if (tag === ID_SINGLETON) return `Switch ${ID} already has A and/or B somewhere, can't create singleton.`;
  return `Switch ${ID} is already defined as a singleton, so can't create ${ID} ${descrip}.`;
}

export function switchConsistencyDefine(ID: number, AB0: number): string | null {
  const complaint = switchConsistencyDefineCheck(ID, AB0);
  if (complaint !== null) return complaint;
  const current = switchMap.get(ID) ?? 0;
  switchMap.set(ID, current | massageTag(AB0));
  return null;
}

export function switchConsistencyTotalCheck(): string | null {
  for (const id of [...switchMap.keys()].sort((a, b) => a - b)) {
    const v = switchMap.get(id)!;
    switch (v) {
      case 1:
        return `Switch half ${id} A exists but there is no B.`;
      case 2:
        return `Switch half ${id} B exists, but there is no A.`;
      default:
        if (v > ID_SINGLETON) return `Switch ${id} has both singleton and paired points (bug).`;
        break;
    }
  }
  return null;
}
