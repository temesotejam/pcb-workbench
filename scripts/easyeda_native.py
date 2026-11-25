"""Run the official EasyEDA Pro client on a PRIVATE runner with an installed CLI.
A source folder is copied before opening; results are review-only. No order APIs.
"""
import argparse,base64,hashlib,json,os,pathlib,shutil,subprocess,tempfile,zipfile

def call(exe,*args,timeout=240):
    p=subprocess.run([exe,*args],capture_output=True,text=True,timeout=timeout)
    if p.returncode: raise RuntimeError('EasyEDA CLI exit '+str(p.returncode)+': '+p.stderr[-1500:])
    try:r=json.loads(p.stdout)
    except ValueError as e:raise RuntimeError('CLI did not return JSON') from e
    if r.get('ok') is not True:raise RuntimeError(str(r.get('error','Unknown CLI error')))
    return r.get('value')

def invoke(exe,session,code,args):
    return call(exe,'invoke','--session',session,'--ext-uuid','eda','--code',code,'--args',json.dumps(args),'--timeout','180000',timeout=200)

def linked(project):
    profile=json.loads(project.read_text(encoding='utf-8-sig'))['profile']
    pcbs=list(profile['pcbs'].values())
    if len(pcbs)!=1:raise ValueError('Expected one PCB')
    pcb=pcbs[0]
    pages=[s['uuid'] for s in profile['sheets'].values() if profile['schematics'][s['schematic_uuid']]['board']==pcb['board']]
    if not pages:raise ValueError('No linked schematic pages')
    return pages,pcb['uuid']

SCH="""const tab=await eda.dmt_EditorControl.openDocument(__CLI__.args.uuid);
if(!tab)throw new Error('Cannot open schematic');
await new Promise(r=>setTimeout(r,3000));
await eda.sch_Document.save();
await new Promise(r=>setTimeout(r,9000));
return {strictPassed:await eda.sch_Drc.check(true,false,false),details:await eda.sch_Drc.check(true,false,true)};"""
PCB="""const tab=await eda.dmt_EditorControl.openDocument(__CLI__.args.uuid);
if(!tab)throw new Error('Cannot open PCB');
await new Promise(r=>setTimeout(r,3000));
await eda.pcb_Document.save();
await new Promise(r=>setTimeout(r,9000));
return {strictPassed:await eda.pcb_Drc.check(true,false,false),details:await eda.pcb_Drc.check(true,false,true)};"""
EXPORT="""const tab=await eda.dmt_EditorControl.openDocument(__CLI__.args.uuid);
if(!tab)throw new Error('Cannot open PCB');
await new Promise(r=>setTimeout(r,3000));
const file=await (async()=>{
 switch(__CLI__.args.kind){
 case 'gerber':return await eda.pcb_ManufactureData.getGerberFile('Gerber');
 case 'bom':return await eda.pcb_ManufactureData.getBomFile('BOM','csv');
 case 'cpl':return await eda.pcb_ManufactureData.getPickAndPlaceFile('CPL','csv');
 case 'step':return await eda.pcb_ManufactureData.get3DFile('Board','step',['Component Model'],'Outfit',true);
 default:throw new Error('Unknown export');
 }
})();
if(!file||!file.size)throw new Error('Missing export');
const b64=await new Promise((resolve,reject)=>{const f=new FileReader();f.onload=()=>resolve(f.result.split(',')[1]);f.onerror=reject;f.readAsDataURL(file);});
return {name:file.name,size:file.size,b64};"""

def main():
    p=argparse.ArgumentParser();p.add_argument('project',type=pathlib.Path);p.add_argument('output',type=pathlib.Path);p.add_argument('--cli',default=os.getenv('EASYEDA_PRO_CLI','easyeda-pro'));p.add_argument('--step',action='store_true');a=p.parse_args()
    project=a.project.resolve();out=a.output.resolve()
    if not project.is_file() or project.suffix!='.eprj3':raise ValueError('Expected .eprj3 file')
    if out.exists():raise ValueError('Output directory must not exist')
    out.mkdir(parents=True);report={'orderReady':False,'engine':'EasyEDA Pro official CLI','checks':{},'exports':{},'status':'blocked'}
    session=None
    try:
        call(a.cli,'doctor')
        # A fresh copied project prevents modifications of the imported baseline.
        source=out/'source';shutil.copytree(project.parent,source)
        copy=source/project.name;pages,board=linked(copy)
        session=call(a.cli,'open','--path',str(copy),'--headless','true')['sessionId']
        for uuid in pages:report['checks']['SCH:'+uuid]=invoke(a.cli,session,SCH,{'uuid':uuid})
        report['checks']['PCB:'+board]=invoke(a.cli,session,PCB,{'uuid':board})
        for kind in ['gerber','bom','cpl']+(['step'] if a.step else []):
            r=invoke(a.cli,session,EXPORT,{'uuid':board,'kind':kind})
            b=base64.b64decode(r['b64'],validate=True)
            if len(b)!=r['size'] or not b:raise ValueError('Export size mismatch '+kind)
            if kind=='gerber':
                import io
                with zipfile.ZipFile(io.BytesIO(b)) as z:
                    if not z.namelist() or z.testzip():raise ValueError('Invalid Gerber zip')
            name={'gerber':'Gerber.zip','bom':'BOM_NATIVE.csv','cpl':'CPL_NATIVE.csv','step':'Board.step'}[kind]
            (out/name).write_bytes(b);report['exports'][name]={'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)}
        report['status']='draft';report['strictPassed']=all(isinstance(x,dict) and x.get('strictPassed') is True for x in report['checks'].values())
        report['blockers']=['Native exports require independent BOM/CPL/geometry/netlist parity, stock, factory and assembly orientation review. No release approval.']
    except Exception as exc:
        report['error']=str(exc);raise
    finally:
        if session:
            try:call(a.cli,'session','close','--session',session,'--destroy')
            except Exception as exc:report['closeError']=str(exc);report['status']='blocked'
        report['sourceSha256']={str(f.relative_to(out)):hashlib.sha256(f.read_bytes()).hexdigest() for f in sorted((out/'source').rglob('*')) if f.is_file()} if (out/'source').exists() else {}
        (out/'REVIEW_ONLY.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
if __name__=='__main__':main()
