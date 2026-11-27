function check(condition,message){if(!condition)throw new Error(message)}

function isObject(v){return v!==null&&typeof v==="object"&&!Array.isArray(v)}

function nameOk(v){return typeof v==="string"&&/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(v)}

function coord(v){return typeof v==="number"&&Number.isFinite(v)&&Math.abs(v)<=10000}

function dimensions(board){return isObject(board)&&[board.width,board.height].every(n=>typeof n==="number"&&Number.isFinite(n)&&n>=1&&n<=1000)}

function partFor(catalog,lcsc){const p=catalog.parts.find(p=>p.lcsc===lcsc&&["resistor","capacitor"].includes(p.kind));check(p,"Unsupported or unregistered part: "+lcsc);return p}

function validateProject(p,catalog){
  check(isObject(p)&&p.schemaVersion===1,"Unsupported project schema");
  check(typeof p.name==="string"&&p.name.trim().length>0&&p.name.length<=100,"Invalid project name");
  check(dimensions(p.board),"Board dimensions must be 1–1000 mm");
  check(Array.isArray(p.components)&&Array.isArray(p.nets)&&p.components.length<=1000&&p.nets.length<=2000,"Invalid project collections");
  const refs=new Set(),names=new Set(),pins=new Set();
  for(const c of p.components){
    check(isObject(c)&&typeof c.ref==="string"&&/^[RC][1-9][0-9]{0,5}$/.test(c.ref)&&!refs.has(c.ref),"Invalid or duplicate component reference");
    const part=partFor(catalog,c.lcsc);
    check(c.ref[0]===(part.kind==="resistor"?"R":"C"),"Reference prefix does not match part kind");
    for(const position of [c.schematic,c.pcb])check(isObject(position)&&coord(position.x)&&coord(position.y)&&[0,90,180,270].includes(position.rotation),"Invalid position or rotation");
    refs.add(c.ref);
  }
  for(const n of p.nets){
    check(isObject(n)&&nameOk(n.name)&&!names.has(n.name)&&Array.isArray(n.pins),"Invalid or duplicate net");
    names.add(n.name);
    for(const pin of n.pins){
      check(isObject(pin)&&refs.has(pin.ref)&&["1","2"].includes(pin.pin),"Unknown component pin");
      const key=pin.ref+":"+pin.pin;
      check(!pins.has(key),"Pin is assigned more than once: "+key);pins.add(key);
    }
  }
  return p;
}

function createProject(name="Untitled",width=40,height=30){
  const p={schemaVersion:1,name,board:{width,height},components:[],nets:[]};
  return validateProject(p,{parts:[]});
}

function applyEdit(project,edit,catalog){
  validateProject(project,catalog);
  check(isObject(edit),"Invalid edit");
  const p=JSON.parse(JSON.stringify(project));
  const component=()=>{const c=p.components.find(x=>x.ref===edit.ref);check(c,"Unknown component: "+edit.ref);return c};
  const net=()=>{const n=p.nets.find(x=>x.name===edit.name);check(n,"Unknown net: "+edit.name);return n};
  switch(edit.type){
    case "board": p.board={width:edit.width,height:edit.height};break;
    case "rename":p.name=edit.name;break;
    case "add-component":{
      const part=partFor(catalog,edit.lcsc),prefix=part.kind==="resistor"?"R":"C";
      let i=1;while(p.components.some(c=>c.ref===prefix+i))i++;
      p.components.push({ref:prefix+i,lcsc:part.lcsc,schematic:{x:0,y:0,rotation:0},pcb:{x:0,y:0,rotation:0}});break;
    }
    case "remove-component":
      component();p.components=p.components.filter(c=>c.ref!==edit.ref);
      for(const n of p.nets)n.pins=n.pins.filter(pin=>pin.ref!==edit.ref);break;
    case "place":{
      const c=component();check(["schematic","pcb"].includes(edit.view),"Invalid view");
      c[edit.view]={x:edit.x,y:edit.y,rotation:edit.rotation};break;
    }
    case "add-net":p.nets.push({name:edit.name,pins:[]});break;
    case "remove-net":net();p.nets=p.nets.filter(n=>n.name!==edit.name);break;
    case "assign-pin":{
      component();check(["1","2"].includes(edit.pin),"Unknown pin");
      const target=edit.name===null?null:net();
      for(const n of p.nets)n.pins=n.pins.filter(x=>x.ref!==edit.ref||x.pin!==edit.pin);
      if(target)target.pins.push({ref:edit.ref,pin:edit.pin});break;
    }
    default:throw new Error("Unsupported edit: "+edit.type);
  }
  return validateProject(p,catalog);
}

function inspectProject(p,catalog){
  validateProject(p,catalog);
  const issues=[],assigned=new Set(p.nets.flatMap(n=>n.pins.map(x=>x.ref+":"+x.pin)));
  if(!p.components.length)issues.push("No components");
  for(const c of p.components){
    for(const pin of ["1","2"])if(!assigned.has(c.ref+":"+pin))issues.push("Unassigned pin: "+c.ref+":"+pin);
    if(Math.abs(c.pcb.x)>p.board.width/2||Math.abs(c.pcb.y)>p.board.height/2)issues.push("Component center outside board: "+c.ref);
  }
  for(const n of p.nets)if(n.pins.length<2)issues.push("Net has fewer than two pins: "+n.name);
  return {issues,orderReady:false,scope:"logical connectivity and center bounds only; no ERC/DRC or footprint verification"};
}

export { createProject, validateProject, applyEdit, inspectProject };
