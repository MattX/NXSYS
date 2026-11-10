/*
 * SetUpLayoutTrainMetrics (SULT) — the load-time part of NXSYS/v2/xtrains.cpp: assigns each
 * TrackSeg a real-world length (RWLength, feet) from station numbers at insulated joints.
 * (The trains themselves — Train, Pointpos, ... — are Phase 4.)
 */
import { TypeId, mapGraphicObjectsOfType } from "./nxgo.js";
import { TSEX } from "./geometry.js";
import { f32 } from "./geometry.js";
import type { TrackSeg } from "./xtgtrack.js";

function sultmMapper1(g: unknown): number {
  const ts = g as TrackSeg;
  if (ts.RWLength >= 0.0) return 0; /* processed already. */

  let endx: TSEX;
  if (ts.Ends[0].Joint && ts.Ends[0].Joint.Insulated && ts.Ends[0].Joint.Nomenclature) endx = TSEX.E0;
  else if (ts.Ends[1].Joint && ts.Ends[1].Joint.Insulated && ts.Ends[1].Joint.Nomenclature) endx = TSEX.E1;
  else return 0;
  const thisJointSn = ts.getEnd(endx).Joint!.stationNumber();
  const r = ts.stationPointsEnd(endx, 0);
  const rwlen = Math.abs(thisJointSn - r.sno);
  ts.spreadRWFactor(rwlen / r.wpcordlen);
  return 0;
}

function sultmMapper2(g: unknown): number {
  const ts = g as TrackSeg;
  /* for debugging/development/default */
  if (ts.RWLength === -1.0) ts.RWLength = f32(ts.Length / 50);
  return 0;
}

export function setUpLayoutTrainMetrics(): void {
  mapGraphicObjectsOfType(TypeId.TRACKSEG, sultmMapper1);
  mapGraphicObjectsOfType(TypeId.TRACKSEG, sultmMapper2);
}
