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
  if(p.routes!==undefined){
    check(Array.isArray(p.routes)&&p.routes.length<=2000,"Invalid route collection");
    const ids=new Set(),pairs=new Set();
    for(const route of p.routes){
      check(isObject(route)&&/^T[1-9][0-9]{0,5}$/.test(route.id)&&!ids.has(route.id),"Invalid or duplicate route ID");
      ids.add(route.id);
      check(route.layer==="top"&&typeof route.width==="number"&&Number.isFinite(route.width)&&route.width>=.05&&route.width<=5,"Invalid route layer or width");
      const n=p.nets.find(n=>n.name===route.net);
      check(n,"Route references an unknown net; delete the route first");
      const endpoint=pin=>isObject(pin)&&n.pins.some(q=>q.ref===pin.ref&&q.pin===pin.pin);
      check(endpoint(route.from)&&endpoint(route.to),"Route endpoint is not on its net; delete the route first");
      const a=route.from.ref+":"+route.from.pin,b=route.to.ref+":"+route.to.pin;
      check(a!==b,"Route needs two different pads");
      const pair=[a,b].sort().join("|");
      check(!pairs.has(pair),"Duplicate pad pair");pairs.add(pair);
      check(Array.isArray(route.waypoints)&&route.waypoints.length<=100,"Invalid route waypoints");
      let prev=null;
      for(const pt of route.waypoints){
        check(isObject(pt)&&coord(pt.x)&&coord(pt.y)&&Math.abs(pt.x)+route.width/2<=p.board.width/2&&Math.abs(pt.y)+route.width/2<=p.board.height/2,"Route waypoint outside board");
        check(!prev||prev.x!==pt.x||prev.y!==pt.y,"Repeated route waypoint");prev=pt;
      }
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
      const old=c[edit.view];
      if(edit.view==="pcb"&&(old.x!==edit.x||old.y!==edit.y||old.rotation!==edit.rotation))
        check(!(p.routes??[]).some(t=>t.from.ref===c.ref||t.to.ref===c.ref),"Delete attached routes before moving this PCB component");
      c[edit.view]={x:edit.x,y:edit.y,rotation:edit.rotation};break;
    }
    case "add-route":{
      const routes=p.routes??(p.routes=[]);
      let i=1;while(routes.some(t=>t.id==="T"+i))i++;
      const pin=q=>({ref:q?.ref,pin:q?.pin});
      const from=pin(edit.from),to=pin(edit.to);
      const n=p.nets.find(n=>[from,to].every(q=>n.pins.some(p=>p.ref===q.ref&&p.pin===q.pin)));
      check(n,"Route pads must be on the same logical net");
      check(Array.isArray(edit.waypoints),"Invalid route waypoints");
      routes.push({id:"T"+i,net:n.name,layer:"top",width:edit.width,from,to,waypoints:edit.waypoints.map(q=>({x:q?.x,y:q?.y}))});break;
    }
    case "remove-route":
      check((p.routes??[]).some(t=>t.id===edit.id),"Unknown route");
      p.routes=p.routes.filter(t=>t.id!==edit.id);break;
    case "add-net":p.nets.push({name:edit.name,pins:[]});break;
    case "remove-net":net();p.nets=p.nets.filter(n=>n.name!==edit.name);break;
    case "connect-pins":{
      const endpoints=[edit.from,edit.to];
      for(const pin of endpoints)check(isObject(pin)&&p.components.some(c=>c.ref===pin.ref)&&["1","2"].includes(pin.pin),"Unknown component pin");
      const same=(a,b)=>a.ref===b.ref&&a.pin===b.pin;
      check(!same(...endpoints),"Choose two different pins");
      const [a,b]=endpoints.map(pin=>p.nets.find(n=>n.pins.some(x=>same(x,pin))));
      check(!a||!b||a===b,"Pins belong to different nets; merge explicitly in the net editor");
      let target=a||b;
      if(!target){
        let i=1;while(p.nets.some(n=>n.name==="Net_"+i))i++;
        target={name:"Net_"+i,pins:[]};p.nets.push(target);
      }
      for(const pin of endpoints)if(!target.pins.some(x=>same(x,pin)))target.pins.push({ref:pin.ref,pin:pin.pin});
      break;
    }
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
  if(p.routes?.length)issues.push("Manual routes require independent physical connectivity and clearance verification; conversion is not supported yet");
  return {issues,orderReady:false,scope:"logical connectivity and center bounds only; no ERC/DRC or footprint verification"};
}

export { createProject, validateProject, applyEdit, inspectProject };
