(() => {
  'use strict';

  const canvas = document.getElementById('world');
  const ctx = canvas.getContext('2d');
  const $ = (id) => document.getElementById(id);
  const GRID_W = 15;
  const GRID_H = 13;
  const TW = 66;
  const TH = 33;
  const SAVE_KEY = 'ingenio-del-bosque-v1';

  const resourceMeta = {
    wood: { label: 'Madera', icon: '▰' },
    stone: { label: 'Piedra', icon: '⬟' },
    ore: { label: 'Mineral', icon: '◆' },
    planks: { label: 'Tablones', icon: '▤' },
    metal: { label: 'Metal', icon: '⬢' },
    energy: { label: 'Energía', icon: 'ϟ' },
  };

  const defs = {
    shelter: {
      name: 'Refugio', icon: '⌂', category: 'base', color: '#9c653a',
      cost: { wood: 12, stone: 4 }, desc: 'Una casa fuerte para descansar cuando anochece.',
      recipe: 'Protege el campamento', placement: 'land'
    },
    lumber: {
      name: 'Recolector', icon: '♣', category: 'production', color: '#567846',
      cost: { wood: 6, stone: 2 }, desc: 'Recoge madera de los árboles cercanos.',
      recipe: 'Árbol cercano → +1 madera', placement: 'nearTree', interval: 2.8
    },
    quarry: {
      name: 'Cantera', icon: '⬟', category: 'production', color: '#737b75',
      cost: { wood: 5, stone: 3 }, desc: 'Separa piedras útiles de las rocas grandes.',
      recipe: 'Roca cercana → +1 piedra', placement: 'nearRock', interval: 3.4
    },
    mine: {
      name: 'Mina', icon: '◆', category: 'production', color: '#565b58',
      cost: { wood: 9, stone: 8 }, desc: 'Extrae mineral oscuro de las vetas del terreno.',
      recipe: 'Veta cercana → +1 mineral', placement: 'nearOre', interval: 3.8
    },
    carpentry: {
      name: 'Carpintería', icon: '▤', category: 'production', color: '#b76b31',
      cost: { wood: 10, stone: 4 }, desc: 'Corta la madera en tablones resistentes.',
      recipe: '2 madera → 1 tablón', placement: 'land', interval: 3.5
    },
    forge: {
      name: 'Forja', icon: '♨', category: 'production', color: '#963e2d',
      cost: { wood: 10, stone: 10, ore: 4 }, desc: 'Calienta el mineral para fabricar piezas de metal.',
      recipe: '2 mineral + 1 energía → 1 metal', placement: 'land', interval: 4.2,
      unlock: () => countType('mine') > 0 && state.resources.energy > 0
    },
    mill: {
      name: 'Molino de agua', icon: '✣', category: 'energy', color: '#518a92',
      cost: { wood: 12, stone: 7 }, desc: 'La corriente hace girar la rueda y crea energía.',
      recipe: 'Junto al río → +1 energía', placement: 'nearWater', interval: 2.7
    },
    dam: {
      name: 'Presa', icon: '≋', category: 'energy', color: '#737d78',
      cost: { wood: 14, stone: 14, metal: 3 }, desc: 'Domina la fuerza del río y produce mucha energía.',
      recipe: 'Sobre el río → +3 energía', placement: 'water', interval: 3,
      unlock: () => countType('forge') > 0 && state.resources.metal >= 3
    },
    garden: {
      name: 'Huerto', icon: '❋', category: 'base', color: '#769341',
      cost: { wood: 5, stone: 2 }, desc: 'Un rincón verde que alegra todo el campamento.',
      recipe: 'Cultiva sin gastar energía', placement: 'land'
    },
    conveyor: {
      name: 'Cinta', icon: '»', category: 'production', color: '#d8a52b',
      cost: { wood: 2 }, desc: 'Mueve materiales y hace visible tu cadena de trabajo.',
      recipe: 'Conecta tus talleres', placement: 'land'
    }
  };

  const missions = [
    { type: 'shelter', text: 'Construye un refugio', hint: 'El refugio puede ir en cualquier casilla verde.' },
    { type: 'lumber', text: 'Pon un recolector junto a un árbol', hint: 'Busca una casilla verde pegada a un pino.' },
    { type: 'mill', text: 'Usa el río con un molino', hint: 'El molino va en tierra, justo al lado del agua.' },
    { type: 'carpentry', text: 'Fabrica tablones en la carpintería', extra: () => state.resources.planks > 0, hint: 'La carpintería transforma 2 maderas en 1 tablón.' },
    { type: 'forge', text: 'Enciende una forja', extra: () => state.resources.metal > 0, hint: 'Necesitas una mina, mineral y energía del molino.' },
    { type: 'dam', text: 'Construye una presa en el río', hint: 'Consigue 3 metales y coloca la presa directamente sobre el agua.' },
  ];

  let dpr = 1;
  let W = 0;
  let H = 0;
  let terrain = [];
  let objects = [];
  let state = freshState();
  let selectedType = null;
  let selectedBuilding = null;
  let hoverCell = null;
  let animationTime = 0;
  let lastTs = performance.now();
  let autosaveTimer = 0;
  let deliveries = [];
  let particles = [];
  let audioCtx = null;

  const camera = { x: 0, y: 0, zoom: 1 };
  const pointer = { down: false, x: 0, y: 0, startX: 0, startY: 0, camX: 0, camY: 0, moved: false };

  function freshState() {
    return {
      resources: { wood: 32, stone: 20, ore: 0, planks: 0, metal: 0, energy: 0 },
      buildings: [], speed: 1, paused: false, sound: true, started: false,
      elapsed: 0, builtTotal: 0, seed: 72491, victoryShown: false
    };
  }

  function mulberry32(seed) {
    return function() {
      let t = seed += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function generateWorld(seed) {
    const rand = mulberry32(seed);
    terrain = [];
    objects = [];
    for (let y = 0; y < GRID_H; y++) {
      const riverX = 7 + Math.round(Math.sin(y * .78) * 1.25);
      for (let x = 0; x < GRID_W; x++) {
        const water = Math.abs(x - riverX) <= (y === 6 || y === 7 ? 1 : 0);
        terrain.push({ x, y, type: water ? 'water' : 'land', shade: rand() });
      }
    }
    const occupied = new Set();
    const addCluster = (kind, count, region) => {
      let guard = 0;
      while (count > 0 && guard++ < 600) {
        const x = region ? region[0] + Math.floor(rand() * region[2]) : Math.floor(rand() * GRID_W);
        const y = region ? region[1] + Math.floor(rand() * region[3]) : Math.floor(rand() * GRID_H);
        const t = getTile(x, y);
        const key = `${x},${y}`;
        if (!t || t.type === 'water' || occupied.has(key) || Math.abs(x - 3) + Math.abs(y - 7) < 3) continue;
        occupied.add(key); objects.push({ x, y, kind, variant: Math.floor(rand() * 3) }); count--;
      }
    };
    addCluster('tree', 24);
    addCluster('rock', 8, [0, 0, 7, 7]);
    addCluster('ore', 6, [8, 5, 7, 8]);
    for (let i = 0; i < 16; i++) {
      let x = Math.floor(rand() * GRID_W), y = Math.floor(rand() * GRID_H);
      const t = getTile(x, y);
      if (t && t.type === 'land' && !occupied.has(`${x},${y}`)) objects.push({ x, y, kind: 'tuft', variant: i % 3 });
    }
  }

  function getTile(x, y) { return terrain.find(t => t.x === x && t.y === y); }
  function objectAt(x, y) { return objects.find(o => o.x === x && o.y === y && o.kind !== 'tuft'); }
  function buildingAt(x, y) { return state.buildings.find(b => b.x === x && b.y === y); }
  function countType(type) { return state.buildings.filter(b => b.type === type).length; }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!camera.x && !camera.y) centerCamera();
  }

  function centerCamera() {
    camera.zoom = W < 720 ? .72 : Math.min(1, Math.max(.8, W / 1300));
    camera.x = W * .52;
    camera.y = Math.max(115, H * .19);
  }

  function iso(x, y) {
    return {
      x: camera.x + (x - y) * TW * .5 * camera.zoom,
      y: camera.y + (x + y) * TH * .5 * camera.zoom,
    };
  }

  function screenToGrid(sx, sy) {
    const px = (sx - camera.x) / camera.zoom;
    const py = (sy - camera.y) / camera.zoom;
    const x = Math.floor(py / TH + px / TW + .5);
    const y = Math.floor(py / TH - px / TW + .5);
    return x >= 0 && y >= 0 && x < GRID_W && y < GRID_H ? { x, y } : null;
  }

  function poly(points, fill, stroke, width = 1) {
    ctx.beginPath();
    points.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); }
  }

  function tint(hex, amount) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.max(0, Math.min(255, (n >> 16) + amount));
    const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amount));
    const b = Math.max(0, Math.min(255, (n & 255) + amount));
    return `rgb(${r},${g},${b})`;
  }

  function cuboid(cx, baseY, w, d, h, color, studs = true) {
    const topY = baseY - h;
    poly([[cx, topY-d/2],[cx+w/2,topY],[cx,topY+d/2],[cx-w/2,topY]], tint(color, 24), '#243028', 1.2);
    poly([[cx-w/2,topY],[cx,topY+d/2],[cx,baseY+d/2],[cx-w/2,baseY]], tint(color,-28), '#243028', 1.2);
    poly([[cx+w/2,topY],[cx,topY+d/2],[cx,baseY+d/2],[cx+w/2,baseY]], tint(color,-48), '#243028', 1.2);
    if (studs && w > 18) {
      const count = Math.max(1, Math.floor(w / 19));
      for (let i=0;i<count;i++) {
        const sx = cx - (count-1)*7 + i*14;
        ctx.beginPath(); ctx.ellipse(sx, topY - 1, 4.3, 2.3, 0, 0, Math.PI*2);
        ctx.fillStyle = tint(color, 40); ctx.fill(); ctx.strokeStyle = tint(color,-10); ctx.stroke();
      }
    }
  }

  function drawTile(tile) {
    const p = iso(tile.x, tile.y);
    const tw = TW * camera.zoom, th = TH * camera.zoom;
    const isHover = hoverCell && hoverCell.x === tile.x && hoverCell.y === tile.y;
    if (tile.type === 'water') {
      const shift = Math.sin(animationTime * 2 + tile.x + tile.y) * 2;
      poly([[p.x,p.y-th/2],[p.x+tw/2,p.y],[p.x,p.y+th/2],[p.x-tw/2,p.y]], tile.shade>.5?'#4c9caf':'#438fa4', '#316d7d', 1);
      ctx.strokeStyle = 'rgba(197,238,235,.4)'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(p.x-tw*.25+shift,p.y);ctx.lineTo(p.x,p.y+th*.12);ctx.lineTo(p.x+tw*.22+shift,p.y);ctx.stroke();
    } else {
      const base = tile.shade > .66 ? '#63804c' : tile.shade > .33 ? '#5a7647' : '#526f43';
      poly([[p.x,p.y-th/2],[p.x+tw/2,p.y],[p.x,p.y+th/2],[p.x-tw/2,p.y]], base, '#3c5b38', 1);
      poly([[p.x-tw/2,p.y],[p.x,p.y+th/2],[p.x,p.y+th/2+7*camera.zoom],[p.x-tw/2,p.y+7*camera.zoom]], '#3d5736', null);
      poly([[p.x+tw/2,p.y],[p.x,p.y+th/2],[p.x,p.y+th/2+7*camera.zoom],[p.x+tw/2,p.y+7*camera.zoom]], '#334d31', null);
      if ((tile.x + tile.y) % 3 === 0 && !objectAt(tile.x,tile.y) && !buildingAt(tile.x,tile.y)) {
        ctx.beginPath();ctx.ellipse(p.x, p.y-2*camera.zoom, 3.2*camera.zoom, 1.7*camera.zoom,0,0,Math.PI*2);ctx.fillStyle='rgba(144,176,91,.48)';ctx.fill();
      }
    }
    if (isHover) {
      const check = selectedType ? canPlace(selectedType, tile.x, tile.y) : { ok: true };
      poly([[p.x,p.y-th/2],[p.x+tw/2,p.y],[p.x,p.y+th/2],[p.x-tw/2,p.y]], check.ok?'rgba(246,204,52,.3)':'rgba(204,66,45,.35)', check.ok?'#ffe27a':'#ff8670', 2.2);
    }
  }

  function drawObject(o) {
    const p = iso(o.x, o.y); const z = camera.zoom;
    ctx.save(); ctx.translate(p.x, p.y - 3*z); ctx.scale(z,z);
    if (o.kind === 'tree') {
      cuboid(0, 0, 10, 8, 32, '#6b4224', false);
      cuboid(0, -26, 42, 28, 23, o.variant===1?'#345f3a':'#3e7041', true);
      cuboid(o.variant===2?7:-6, -44, 32, 23, 22, '#497f43', true);
      cuboid(1, -59, 21, 16, 14, '#5c914b', true);
    } else if (o.kind === 'rock' || o.kind === 'ore') {
      const c = o.kind==='ore' ? '#4c5559' : '#777d73';
      cuboid(-7, 0, 24, 18, 15, c, true); cuboid(9, 1, 19, 15, 10, tint(c,-8), true);
      if (o.kind==='ore') { ctx.beginPath();ctx.arc(-6,-12,3,0,Math.PI*2);ctx.fillStyle='#e7a736';ctx.fill(); }
    } else if (o.kind === 'tuft') {
      ctx.strokeStyle = o.variant===0?'#94a658':'#77904c';ctx.lineWidth=2;
      ctx.beginPath();ctx.moveTo(-5,0);ctx.lineTo(-7,-10);ctx.moveTo(0,0);ctx.lineTo(0,-13);ctx.moveTo(5,0);ctx.lineTo(8,-9);ctx.stroke();
    }
    ctx.restore();
  }

  function drawGear(x,y,r,rotation,color='#d3a62d') {
    ctx.save();ctx.translate(x,y);ctx.rotate(rotation);ctx.fillStyle=color;ctx.strokeStyle='#28322d';ctx.lineWidth=2;
    ctx.beginPath();
    for(let i=0;i<24;i++){const a=i*Math.PI/12;const rr=i%3===0?r+4:r;const px=Math.cos(a)*rr,py=Math.sin(a)*rr;i?ctx.lineTo(px,py):ctx.moveTo(px,py)}
    ctx.closePath();ctx.fill();ctx.stroke();ctx.beginPath();ctx.arc(0,0,r*.35,0,Math.PI*2);ctx.fillStyle='#36413c';ctx.fill();ctx.stroke();ctx.restore();
  }

  function drawBuilding(b) {
    const p = iso(b.x,b.y); const z=camera.zoom; const active = buildingActive(b);
    ctx.save();ctx.translate(p.x,p.y-5*z);ctx.scale(z,z);
    ctx.shadowColor='rgba(0,0,0,.28)';ctx.shadowBlur=7;ctx.shadowOffsetY=5;
    cuboid(0,4,49,31,7,'#3d4843',true);ctx.shadowColor='transparent';
    const type=b.type;
    if(type==='shelter'){
      cuboid(0,-2,41,27,30,'#9c6238',true);
      poly([[-25,-31],[0,-53],[25,-31],[0,-19]],'#3f4843','#232b27',2);
      cuboid(9,-1,11,6,20,'#473225',false);
      ctx.fillStyle='#efd15c';ctx.fillRect(-16,-24,9,9);ctx.strokeStyle='#403a26';ctx.strokeRect(-16,-24,9,9);
    } else if(type==='lumber'){
      cuboid(8,-1,30,22,24,'#667649',true);cuboid(-15,0,10,9,29,'#565d50',false);
      drawGear(-18,-21,13,active?animationTime*2:0,'#d68b2c');
      ctx.strokeStyle='#d7aa67';ctx.lineWidth=6;ctx.beginPath();ctx.moveTo(0,1);ctx.lineTo(22,-9);ctx.stroke();
    } else if(type==='quarry'){
      cuboid(-8,0,25,22,17,'#767d78',true);cuboid(15,0,10,10,30,'#c18a2c',true);
      ctx.strokeStyle='#d7aa2a';ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(16,-28);ctx.lineTo(-15,-40);ctx.lineTo(-15,-15);ctx.stroke();
      ctx.fillStyle='#4e5753';ctx.fillRect(-22,-16,13,10);
    } else if(type==='mine'){
      cuboid(0,1,43,29,26,'#575f5c',true);
      ctx.fillStyle='#1a201e';ctx.beginPath();ctx.arc(0,-10,11,Math.PI,0);ctx.lineTo(11,4);ctx.lineTo(-11,4);ctx.closePath();ctx.fill();
      ctx.strokeStyle='#c49332';ctx.lineWidth=4;ctx.stroke();drawGear(17,-23,8,active?animationTime:0,'#c0922c');
    } else if(type==='carpentry'){
      cuboid(3,0,39,27,22,'#a86132',true);cuboid(-11,-20,8,8,23,'#4f5752',true);
      poly([[-24,-23],[2,-42],[26,-23],[0,-11]],'#71523a','#332d25',2);
      ctx.strokeStyle='#e4b267';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(-20,1);ctx.lineTo(21,-8);ctx.stroke();
    } else if(type==='forge'){
      cuboid(0,0,42,28,29,'#843a2c',true);cuboid(12,-24,12,10,33,'#444d49',true);
      ctx.fillStyle=active?'#ffb637':'#371f1a';ctx.fillRect(-13,-18,17,13);ctx.strokeStyle='#2a2822';ctx.lineWidth=3;ctx.strokeRect(-13,-18,17,13);
      drawGear(-18,-27,8,active?animationTime*1.5:0,'#8d9994');
      if(active && Math.sin(animationTime*3)>-.2) particles.push({x:p.x+12*z,y:p.y-63*z,life:1,size:5+Math.random()*4,vx:(Math.random()-.5)*7,vy:-12-Math.random()*8});
    } else if(type==='mill'){
      cuboid(7,0,32,25,35,'#8d673e',true);poly([[-13,-35],[8,-52],[28,-35],[7,-24]],'#48514d','#252c29',2);
      drawGear(-19,-17,18,active?animationTime*1.8:0,'#9f612d');
      ctx.strokeStyle='#bc7434';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(-19,-36);ctx.lineTo(-19,2);ctx.stroke();
    } else if(type==='dam'){
      cuboid(0,3,57,35,25,'#747f7a',true);cuboid(-19,-20,13,11,17,'#be8b31',true);cuboid(19,-20,13,11,17,'#be8b31',true);
      ctx.fillStyle='#3d6570';ctx.fillRect(-11,-19,22,23);ctx.strokeStyle='#263b40';ctx.lineWidth=2;ctx.strokeRect(-11,-19,22,23);
      for(let i=0;i<3;i++){ctx.fillStyle='rgba(179,227,225,.6)';ctx.fillRect(-9+i*7,-13+((animationTime*18+i*5)%22),4,8)}
    } else if(type==='garden'){
      cuboid(0,2,48,29,5,'#7c542d',true);
      for(let i=-1;i<=1;i++)for(let j=0;j<2;j++){ctx.fillStyle='#7fa047';ctx.beginPath();ctx.arc(i*13+j*3-2,-7-j*7,5,0,Math.PI*2);ctx.fill();ctx.fillStyle='#c0d566';ctx.beginPath();ctx.arc(i*13+j*3-3,-9-j*7,2,0,Math.PI*2);ctx.fill()}
    } else if(type==='conveyor'){
      cuboid(0,3,50,25,8,'#5a625e',true);ctx.strokeStyle='#e9bd36';ctx.lineWidth=3;
      for(let i=-18;i<23;i+=12){const shift=(animationTime*16)%12;ctx.beginPath();ctx.moveTo(i+shift,-7);ctx.lineTo(i+6+shift,-3);ctx.lineTo(i+shift,1);ctx.stroke()}
    }
    if(selectedBuilding && selectedBuilding.id===b.id){ctx.strokeStyle='#ffe16a';ctx.lineWidth=3;ctx.setLineDash([5,4]);ctx.beginPath();ctx.ellipse(0,5,34,17,0,0,Math.PI*2);ctx.stroke();ctx.setLineDash([])}
    if(!active && defs[type].interval){ctx.fillStyle='#d0573f';ctx.beginPath();ctx.arc(19,-40,6,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=1;ctx.stroke()}
    ctx.restore();
  }

  function drawDeliveries() {
    deliveries.forEach(d=>{
      const a=iso(d.from.x,d.from.y), b=iso(d.to.x,d.to.y);const t=Math.min(1,d.t/d.duration);const e=t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2;
      const x=a.x+(b.x-a.x)*e,y=a.y+(b.y-a.y)*e-20*Math.sin(Math.PI*t);
      ctx.save();ctx.translate(x,y);ctx.rotate(animationTime*2);ctx.fillStyle=d.color;ctx.strokeStyle='#27312c';ctx.lineWidth=2;ctx.fillRect(-5,-5,10,10);ctx.strokeRect(-5,-5,10,10);ctx.restore();
    });
  }

  function drawParticles(dt) {
    particles.forEach(p=>{p.life-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.size+=dt*6;ctx.globalAlpha=Math.max(0,p.life)*.38;ctx.fillStyle='#d4d5cd';ctx.beginPath();ctx.arc(p.x,p.y,p.size,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1});
    particles=particles.filter(p=>p.life>0).slice(-35);
  }

  function render(ts) {
    const rawDt=Math.min(.05,(ts-lastTs)/1000||0);lastTs=ts;animationTime+=rawDt*(state.paused?0:state.speed);
    const dt=rawDt*(state.paused?0:state.speed);
    update(dt);
    ctx.clearRect(0,0,W,H);
    const bg=ctx.createLinearGradient(0,0,0,H);bg.addColorStop(0,'rgba(177,198,154,.26)');bg.addColorStop(1,'rgba(25,48,39,.18)');ctx.fillStyle=bg;ctx.fillRect(0,0,W,H);
    ctx.save();
    const vignette=ctx.createRadialGradient(W*.54,H*.45,80,W*.54,H*.45,Math.max(W,H)*.7);vignette.addColorStop(0,'rgba(255,255,255,0)');vignette.addColorStop(1,'rgba(9,20,15,.38)');ctx.fillStyle=vignette;ctx.fillRect(0,0,W,H);
    ctx.restore();
    terrain.slice().sort((a,b)=>(a.x+a.y)-(b.x+b.y)).forEach(drawTile);
    const sprites=[...objects,...state.buildings.map(b=>({...b,kind:'building'}))].sort((a,b)=>(a.x+a.y)-(b.x+b.y)||a.x-b.x);
    sprites.forEach(s=>s.kind==='building'?drawBuilding(s):drawObject(s));
    drawDeliveries();drawParticles(rawDt);
    requestAnimationFrame(render);
  }

  function nearbyKind(x,y,kind,r=2){return objects.some(o=>o.kind===kind&&Math.abs(o.x-x)+Math.abs(o.y-y)<=r)}
  function nearWater(x,y){return terrain.some(t=>t.type==='water'&&Math.abs(t.x-x)+Math.abs(t.y-y)===1)}

  function canPlace(type,x,y){
    const def=defs[type],tile=getTile(x,y);
    if(!def||!tile)return{ok:false,reason:'Fuera del mapa'};
    if(buildingAt(x,y))return{ok:false,reason:'Ya hay una construcción aquí'};
    if(objectAt(x,y))return{ok:false,reason:'La casilla está ocupada'};
    if(def.placement==='water'&&tile.type!=='water')return{ok:false,reason:'La presa va sobre el río'};
    if(def.placement!=='water'&&tile.type==='water')return{ok:false,reason:'Esta pieza necesita tierra firme'};
    if(def.placement==='nearTree'&&!nearbyKind(x,y,'tree'))return{ok:false,reason:'Necesita un árbol cerca'};
    if(def.placement==='nearRock'&&!nearbyKind(x,y,'rock'))return{ok:false,reason:'Necesita una roca cerca'};
    if(def.placement==='nearOre'&&!nearbyKind(x,y,'ore'))return{ok:false,reason:'Necesita una veta amarilla cerca'};
    if(def.placement==='nearWater'&&!nearWater(x,y))return{ok:false,reason:'Necesita tocar el río'};
    return{ok:true};
  }

  function canAfford(cost){return Object.entries(cost).every(([k,v])=>state.resources[k]>=v)}
  function spend(cost){Object.entries(cost).forEach(([k,v])=>state.resources[k]-=v)}

  function place(type,x,y){
    const def=defs[type];
    if(def.unlock&&!def.unlock()){toast(type==='forge'?'Primero: mina + molino con energía.':'Primero fabrica 3 piezas de metal en la forja.','bad');return}
    const check=canPlace(type,x,y);if(!check.ok){toast(check.reason,'bad');bloop(120);return}
    if(!canAfford(def.cost)){toast('Te faltan materiales. Deja trabajar a tus máquinas.','bad');bloop(120);return}
    spend(def.cost);state.buildings.push({id:Date.now()+Math.random(),type,x,y,timer:0,cycles:0});state.builtTotal++;
    selectedType=null;canvas.classList.remove('placing');updateBuildList();updateResources();updateMissions();toast(`${def.name} encajado. ¡Clac!`,'good');bloop(440);save();
  }

  function buildingActive(b){
    if(state.paused)return false;
    if(b.type==='lumber')return nearbyKind(b.x,b.y,'tree');
    if(b.type==='quarry')return nearbyKind(b.x,b.y,'rock');
    if(b.type==='mine')return nearbyKind(b.x,b.y,'ore');
    if(b.type==='mill')return nearWater(b.x,b.y);
    if(b.type==='dam')return getTile(b.x,b.y)?.type==='water';
    if(b.type==='carpentry')return state.resources.wood>=2&&state.resources.planks<10;
    if(b.type==='forge')return state.resources.ore>=2&&state.resources.energy>=1&&state.resources.metal<12;
    return true;
  }

  function nearest(type,b){
    let arr=state.buildings.filter(x=>x.type===type&&x.id!==b.id);arr.sort((a,c)=>(Math.abs(a.x-b.x)+Math.abs(a.y-b.y))-(Math.abs(c.x-b.x)+Math.abs(c.y-b.y)));return arr[0];
  }

  function deliver(from,to,color){if(to)deliveries.push({from,to,color,t:0,duration:.8})}
  function produce(b){
    if(!buildingActive(b))return;
    b.cycles++;
    if(b.type==='lumber'){state.resources.wood+=1;deliver(b,nearest('carpentry',b),'#a86b38')}
    else if(b.type==='quarry'){state.resources.stone+=1;}
    else if(b.type==='mine'){state.resources.ore+=1;deliver(b,nearest('forge',b),'#d59d2e')}
    else if(b.type==='carpentry'){state.resources.wood-=2;state.resources.planks+=1;}
    else if(b.type==='forge'){state.resources.ore-=2;state.resources.energy-=1;state.resources.metal+=1;}
    else if(b.type==='mill'){state.resources.energy+=1;deliver(b,nearest('forge',b),'#f2cd3c')}
    else if(b.type==='dam'){state.resources.energy+=3;deliver(b,nearest('forge',b),'#74d5d7')}
    flashResources();bloop(b.type==='forge'?260:620,.025);updateResources();updateMissions();
  }

  function update(dt){
    if(!state.paused){state.elapsed+=dt;state.buildings.forEach(b=>{const def=defs[b.type];if(def.interval){b.timer+=dt;if(b.timer>=def.interval){b.timer=0;produce(b)}}});}
    deliveries.forEach(d=>d.t+=dt);deliveries=deliveries.filter(d=>d.t<d.duration);
    autosaveTimer+=dt;if(autosaveTimer>8){autosaveTimer=0;save()}
    if(selectedBuilding)updateInspectorStatus();
  }

  function formatCost(cost){return Object.entries(cost).map(([k,v])=>`${resourceMeta[k].icon}${v}`).join(' ')}
  function updateResources(){
    const el=$('resources');
    el.innerHTML=Object.entries(resourceMeta).map(([key,m])=>`<div class="resource" data-resource="${key}"><span class="resource-icon">${m.icon}</span><span><b>${Math.floor(state.resources[key])}</b><small>${m.label}</small></span></div>`).join('');
  }
  function flashResources(){document.querySelectorAll('.resource').forEach(el=>{el.classList.remove('flash');void el.offsetWidth;el.classList.add('flash')})}

  function updateBuildList(filter='all'){
    const list=$('buildList');const current=document.querySelector('.tab.active')?.dataset.tab||filter;
    list.innerHTML=Object.entries(defs).filter(([,d])=>current==='all'||d.category===current).map(([key,d])=>{
      const locked=d.unlock&&!d.unlock();return `<button class="build-card ${selectedType===key?'selected':''} ${locked?'locked':''}" data-build="${key}" type="button" aria-label="Construir ${d.name}. Cuesta ${formatCost(d.cost)}" ${locked?'aria-disabled="true"':''}><span class="build-icon" style="border-top:3px solid ${d.color}">${d.icon}</span><b>${d.name}</b><span class="cost">${formatCost(d.cost)}</span>${locked?'<span class="lock-note">🔒</span>':''}</button>`;
    }).join('');
    list.querySelectorAll('[data-build]').forEach(btn=>btn.addEventListener('click',()=>{
      const type=btn.dataset.build,def=defs[type];if(def.unlock&&!def.unlock()){toast(type==='forge'?'Se abre cuando tengas una mina y energía.':'Se abre al fabricar 3 metales.','bad');return}
      selectedType=selectedType===type?null:type;selectedBuilding=null;hideInspector();canvas.classList.toggle('placing',!!selectedType);$('selectionHelp').textContent=selectedType?placementHelp(defs[selectedType]):'Elige una pieza';updateBuildList(current);
    }));
  }

  function placementHelp(d){
    return {water:'Ponla sobre el río',nearTree:'Busca un árbol cercano',nearRock:'Busca rocas cercanas',nearOre:'Busca vetas amarillas',nearWater:'Ponlo al borde del río',land:'Toca una casilla verde'}[d.placement];
  }

  function missionDone(m){const built=countType(m.type)>0;return built&&(!m.extra||m.extra())}
  function updateMissions(){
    const done=missions.filter(missionDone).length;
    $('missions').innerHTML=missions.map(m=>`<div class="mission ${missionDone(m)?'done':''}"><span class="mission-check">✓</span><span>${m.text}</span></div>`).join('');
    $('missionProgress').style.width=`${done/missions.length*100}%`;
    updateBuildList();
    if(done===missions.length&&!state.victoryShown){state.victoryShown=true;setTimeout(showVictory,700)}
  }

  function showVictory(){
    $('victoryStats').innerHTML=`<div><b>${state.builtTotal}</b><small>inventos</small></div><div><b>${Math.floor(state.elapsed/60)} min</b><small>tiempo</small></div><div><b>${state.resources.energy}</b><small>energía</small></div>`;$('victory').classList.remove('hidden');bloop(523,.1);setTimeout(()=>bloop(659,.1),130);setTimeout(()=>bloop(784,.14),260);save();
  }

  function toast(msg,type=''){const el=document.createElement('div');el.className=`toast ${type}`;el.textContent=msg;$('toasts').appendChild(el);setTimeout(()=>el.remove(),3100)}

  function openInspector(b){
    selectedBuilding=b;const d=defs[b.type];$('inspectorIcon').textContent=d.icon;$('inspectorIcon').style.borderTop=`4px solid ${d.color}`;$('inspectorName').textContent=d.name;$('inspectorDesc').textContent=d.desc;$('inspectorRecipe').innerHTML=`<b>RECETA</b><br>${d.recipe}`;$('inspectorType').textContent=d.category==='energy'?'ENERGÍA':d.category==='base'?'CAMPAMENTO':'MÁQUINA';$('inspector').classList.remove('hidden');updateInspectorStatus();
  }
  function hideInspector(){selectedBuilding=null;$('inspector').classList.add('hidden')}
  function updateInspectorStatus(){if(!selectedBuilding)return;const on=buildingActive(selectedBuilding);let waiting='Esperando materiales';if(selectedBuilding.type==='carpentry'&&state.resources.planks>=10)waiting='Almacén de tablones lleno';if(selectedBuilding.type==='forge'&&state.resources.metal>=12)waiting='Almacén de metal lleno';$('inspectorStatus').textContent=on?'En marcha':waiting;document.querySelector('.machine-status .pulse').classList.toggle('off',!on)}

  function refundAndRemove(){
    if(!selectedBuilding)return;const d=defs[selectedBuilding.type];Object.entries(d.cost).forEach(([k,v])=>state.resources[k]+=Math.ceil(v*.7));state.buildings=state.buildings.filter(b=>b.id!==selectedBuilding.id);toast('Piezas recuperadas: 70% de los materiales.','good');hideInspector();updateResources();updateBuildList();updateMissions();save();
  }

  function save(){try{localStorage.setItem(SAVE_KEY,JSON.stringify(state))}catch(e){/* private mode */}}
  function load(){
    try{const raw=localStorage.getItem(SAVE_KEY);if(raw){const saved=JSON.parse(raw);state={...freshState(),...saved,resources:{...freshState().resources,...saved.resources}}}}catch(e){state=freshState()}
  }

  function bloop(freq=440,volume=.04){
    if(!state.sound)return;try{audioCtx=audioCtx||new(window.AudioContext||window.webkitAudioContext)();const o=audioCtx.createOscillator(),g=audioCtx.createGain();o.type='triangle';o.frequency.setValueAtTime(freq,audioCtx.currentTime);o.frequency.exponentialRampToValueAtTime(freq*.78,audioCtx.currentTime+.09);g.gain.setValueAtTime(volume,audioCtx.currentTime);g.gain.exponentialRampToValueAtTime(.001,audioCtx.currentTime+.1);o.connect(g);g.connect(audioCtx.destination);o.start();o.stop(audioCtx.currentTime+.11)}catch(e){/* no audio */}
  }

  function pointerPos(e){const r=canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top}}
  canvas.addEventListener('pointerdown',e=>{const p=pointerPos(e);pointer.down=true;pointer.x=pointer.startX=p.x;pointer.y=pointer.startY=p.y;pointer.camX=camera.x;pointer.camY=camera.y;pointer.moved=false;canvas.setPointerCapture(e.pointerId)});
  canvas.addEventListener('pointermove',e=>{const p=pointerPos(e);hoverCell=screenToGrid(p.x,p.y);if(pointer.down){const dx=p.x-pointer.startX,dy=p.y-pointer.startY;if(Math.hypot(dx,dy)>7)pointer.moved=true;if(pointer.moved){camera.x=pointer.camX+dx;camera.y=pointer.camY+dy;canvas.classList.add('dragging')}}updateTooltip(p)});
  canvas.addEventListener('pointerup',e=>{const p=pointerPos(e);canvas.classList.remove('dragging');if(!pointer.moved){const cell=screenToGrid(p.x,p.y);if(cell){if(selectedType)place(selectedType,cell.x,cell.y);else{const b=buildingAt(cell.x,cell.y);b?openInspector(b):hideInspector()}}}pointer.down=false});
  canvas.addEventListener('pointerleave',()=>{hoverCell=null;$('tileTooltip').classList.add('hidden')});
  canvas.addEventListener('contextmenu',e=>e.preventDefault());
  canvas.addEventListener('wheel',e=>{e.preventDefault();camera.zoom=Math.max(.55,Math.min(1.4,camera.zoom+(e.deltaY<0?.08:-.08)))},{passive:false});

  function updateTooltip(p){
    const tip=$('tileTooltip');if(!hoverCell){tip.classList.add('hidden');return}let text='';if(selectedType){const check=canPlace(selectedType,hoverCell.x,hoverCell.y);text=check.ok?`Colocar ${defs[selectedType].name}`:check.reason}else{const b=buildingAt(hoverCell.x,hoverCell.y),o=objectAt(hoverCell.x,hoverCell.y),t=getTile(hoverCell.x,hoverCell.y);text=b?defs[b.type].name:o?({tree:'Pino · madera',rock:'Roca · piedra',ore:'Veta · mineral'}[o.kind]):t?.type==='water'?'Río':'Terreno libre'}tip.textContent=text;tip.style.left=`${p.x}px`;tip.style.top=`${p.y}px`;tip.classList.remove('hidden');
  }

  document.querySelectorAll('.tab').forEach(tab=>tab.addEventListener('click',()=>{document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));tab.classList.add('active');updateBuildList(tab.dataset.tab)}));
  document.querySelectorAll('.speed-btn').forEach(btn=>btn.addEventListener('click',()=>{state.speed=Number(btn.dataset.speed);state.paused=false;document.querySelectorAll('.speed-btn').forEach(b=>b.classList.toggle('active',b===btn));$('pauseBtn').textContent='Ⅱ';toast(`Velocidad ×${state.speed}`)}));
  $('pauseBtn').addEventListener('click',()=>{state.paused=!state.paused;$('pauseBtn').textContent=state.paused?'▶':'Ⅱ';toast(state.paused?'Campamento en pausa':'¡Máquinas en marcha!')});
  $('soundBtn').addEventListener('click',()=>{state.sound=!state.sound;$('soundBtn').textContent=state.sound?'♪':'×';if(state.sound)bloop(550);save()});
  $('zoomIn').addEventListener('click',()=>camera.zoom=Math.min(1.4,camera.zoom+.12));
  $('zoomOut').addEventListener('click',()=>camera.zoom=Math.max(.55,camera.zoom-.12));
  $('centerMap').addEventListener('click',centerCamera);
  $('closeInspector').addEventListener('click',hideInspector);
  $('removeBtn').addEventListener('click',refundAndRemove);
  $('hintBtn').addEventListener('click',()=>{const next=missions.find(m=>!missionDone(m));toast(next?next.hint:'¡Ya lo has descubierto todo!','good');bloop(700)});
  $('startBtn').addEventListener('click',startGame);$('welcomeClose').addEventListener('click',startGame);
  function startGame(){state.started=true;$('welcome').classList.add('hidden');bloop(392,.08);setTimeout(()=>bloop(523,.08),110);save()}
  $('continueBtn').addEventListener('click',()=>$('victory').classList.add('hidden'));
  window.addEventListener('keydown',e=>{if(e.key==='Escape'){selectedType=null;canvas.classList.remove('placing');hideInspector();updateBuildList();$('selectionHelp').textContent='Elige una pieza'}if(e.key==='Delete')refundAndRemove();if(e.code==='Space'&&!e.repeat){e.preventDefault();$('pauseBtn').click()}});
  window.addEventListener('resize',resize);

  load();generateWorld(state.seed);resize();updateResources();updateBuildList();updateMissions();
  if(state.started)$('welcome').classList.add('hidden');
  $('soundBtn').textContent=state.sound?'♪':'×';
  requestAnimationFrame(render);
})();
