import { readFileSync } from "node:fs";
import { startUpNXSYS, getLayout } from "../src/interlocking/nxsys.js";
import { setFileReader } from "../src/interlocking/rdtrkcmn.js";
import { TypeId, mapGraphicObjectsOfType } from "../src/layout/nxgo.js";
setFileReader((p)=>{try{return readFileSync(p,"latin1")}catch{return null}});
startUpNXSYS();
getLayout(process.argv[2], true);
const flip=(e:number)=>1-e;
mapGraphicObjectsOfType(TypeId.TRACKSEG,(g:any)=>{
  for (const i of [0,1]) {
    if (g.Ends[i].Next===null && g.Ends[i].Joint?.Nomenclature && g.Ends[i].Joint.Nomenclature<10000) {
      let ts=g, endx=1-i; const out:string[]=[`start nom ${g.Ends[i].Joint.Nomenclature}: tc${g.TCNO}(${ts.RWLength.toFixed(1)})`];
      let n=0;
      while(ts && n++<40){
        const ep=ts.Ends[endx];
        if(ep.Next===null){out.push("END");break;}
        const sw=ep.FacingSwitch; 
        if(sw) out.push(`[sw${sw.XlkgNo ?? sw.Nomenclature ?? "?"}${ep.NextIfSwitchThrown?" alt tc"+ep.NextIfSwitchThrown.TCNO:""}]`);
        const nxt=ep.Next; const ne=flip(ep.EndIndexNormal);
        const s=nxt.Ends[1-ne].SignalProtectingEntrance;
        if(s) out.push(`sig${s.XlkgNo}`);
        out.push(`tc${nxt.TCNO}(${nxt.RWLength.toFixed(1)})`);
        ts=nxt; endx=ne;
      }
      console.log(out.join(" "));
    }
  }
  return 0;
});
