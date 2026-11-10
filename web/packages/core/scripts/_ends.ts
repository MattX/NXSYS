import { readFileSync } from "node:fs";
import { startUpNXSYS, getLayout } from "../src/interlocking/nxsys.js";
import { setFileReader } from "../src/interlocking/rdtrkcmn.js";
import { TypeId, mapGraphicObjectsOfType } from "../src/layout/nxgo.js";
setFileReader((p)=>{try{return readFileSync(p,"latin1")}catch{return null}});
startUpNXSYS();
getLayout(process.argv[2], true);
mapGraphicObjectsOfType(TypeId.TRACKSEG,(g:any)=>{
  for (const i of [0,1]) {
    if (g.Ends[i].Next===null) {
      const o=g.Ends[1-i];
      console.log("end seg: tc", g.TCNO, "joint-at-open-end nom", g.Ends[i].Joint?.Nomenclature, "other joint nom", o.Joint?.Nomenclature, "RW", g.RWLength, "otherNext", !!o.Next, "sigAtOther", o.SignalProtectingEntrance?.XlkgNo ?? "-");
    }
  }
  return 0;
});
