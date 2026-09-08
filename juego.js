import { database } from './firebase-config.js';
import { get, onValue, push, ref, set, update } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js';

const CELL = 56;
const META = 100;
const ESCALERAS = {7:{to:27,color:'green'},43:{to:64,color:'red'}};
const SERPIENTES = {88:68,96:76};
const CARD_TYPES = {8:'bono',30:'bono',52:'bono',18:'contratiempo',68:'contratiempo',82:'contratiempo'};
const CARD_CELLS = new Set(Object.keys(CARD_TYPES).map(Number));
const MAZO_BONO = [
  {nombre:'Terminaste Libre Elección',desc:'Avanza 22 créditos de una sola vez',valor:22,esLE:true,imagen:'cartas/bono_libre_eleccion.png'},
  {nombre:'Completaste Servicio Social',desc:'Avanza 16 créditos de inmediato',valor:16,imagen:'cartas/bono_servicio_social.png'},
  {nombre:'Beca por promedio',desc:'Tira el dado 2 veces adicionales en este turno',extraTiros:2,imagen:'cartas/bono_beca_promedio.png'},
  {nombre:'Pasaste veranos',desc:'Aprobaste tu materia de verano, avanza 6 créditos',valor:6,imagen:'cartas/bono_veranos.png'}
];
const MAZO_CONTRATIEMPO = [
  {nombre:'Semestre Difícil',desc:'Te tocaron los maestros más difíciles, retrocede 10 créditos',valor:-10,imagen:'cartas/contratiempo_semestre_dificil.png'},
  {nombre:'Baja temporal',desc:'Pierdes tu próximo turno completo',turnosPerdidos:1,imagen:'cartas/contratiempo_baja_temporal.png'},
  {nombre:'Reprobaste veranos',desc:'No acreditaste tu materia de verano, retrocede 6 créditos',valor:-6,imagen:'cartas/contratiempo_veranos.png'},
  {nombre:'Reprobaste por faltas',desc:'Perdiste el derecho a examen, retrocede 4 créditos',valor:-4,imagen:'cartas/contratiempo_faltas.png'}
];
const PLAYER_COLORS = ['#e63946','#457b9d','#f4a261','#2a9d8f','#9d4edd','#ffb703','#06d6a0'];
const DICE_RESULT_TIME = 3200;
const BOARD_VIEW_TIME = 2500;
const CARD_RESULT_TIME = 4000;
let players = [];
let running = false;
let delay = 500;
let cancelPendingWait = ()=>{};
let onlineMode = false;
let onlineRoomId = '';
let onlinePlayerId = '';
let onlineUnsubscribe = null;

function cellCoord(n){
  const idx=n-1, rowFromBottom=Math.floor(idx/10), colInRow=idx%10;
  return {col:rowFromBottom%2===0?colInRow:9-colInRow,row:9-rowFromBottom};
}
function buildBoard(){
  const board=document.getElementById('board'); board.innerHTML='';
  for(let n=1;n<=100;n++){
    const {col,row}=cellCoord(n), div=document.createElement('div');
    div.className='cell'; div.style.gridColumnStart=col+1; div.style.gridRowStart=row+1; div.id='cell-'+n;
    let icon='';
    if(n===1){div.classList.add('start');icon='🎒';} if(n===100){div.classList.add('goal');icon='🎓';}
    if(ESCALERAS[n]){div.classList.add(ESCALERAS[n].color==='green'?'ladder-green':'ladder-red');icon='⬆️';}
    if(SERPIENTES[n]){div.classList.add('snake');icon='⬇️';}
    if(CARD_CELLS.has(n)&&!ESCALERAS[n]&&!SERPIENTES[n]){div.classList.add('card-cell');icon='🃏';}
    div.innerHTML=`<span class="num">${n}</span>${icon?`<span class="icon">${icon}</span>`:''}`; board.appendChild(div);
  }
  drawConnectors();
}
function drawConnectors(){
  const svg=document.getElementById('svg-overlay'); svg.innerHTML='';
  const centerOf=n=>{const {col,row}=cellCoord(n);return {x:col*CELL+CELL/2,y:row*CELL+CELL/2};};
  const line=(a,b,color)=>{const p1=centerOf(a),p2=centerOf(b),l=document.createElementNS('http://www.w3.org/2000/svg','line');
    l.setAttribute('x1',p1.x);l.setAttribute('y1',p1.y);l.setAttribute('x2',p2.x);l.setAttribute('y2',p2.y);l.setAttribute('stroke',color);l.setAttribute('stroke-width','4');l.setAttribute('stroke-linecap','round');l.setAttribute('opacity','.75');svg.appendChild(l);};
  for(const origin in ESCALERAS){const e=ESCALERAS[origin];line(Number(origin),e.to,e.color==='green'?'#35c759':'#ef4444');}
  for(const origin in SERPIENTES) line(Number(origin),SERPIENTES[origin],'#b52b45');
}
const TOKEN_OFFSETS=[[6,6],[30,6],[6,30],[30,30],[18,2],[2,18],[34,34]];
function renderTokens(){
  document.querySelectorAll('.token').forEach(t=>t.remove()); const board=document.getElementById('board');
  players.forEach((p,idx)=>{const pos=Math.max(1,p.pos===0?1:p.pos),{col,row}=cellCoord(pos),off=TOKEN_OFFSETS[idx%TOKEN_OFFSETS.length],token=document.createElement('div');
    token.className='token';token.style.background=p.color;token.style.left=col*CELL+off[0]+'px';token.style.top=row*CELL+off[1]+'px';token.textContent=idx+1;token.title=p.name;board.appendChild(token);});
}
function log(){/* El registro visual se conserva desactivado. */}
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
function showModal(id){document.getElementById(id).classList.remove('hidden');} function hideModal(id){document.getElementById(id).classList.add('hidden');}
function efectoCarta(carta){if(carta.extraTiros)return'Tira el dado 2 veces adicionales en este turno.';if(carta.turnosPerdidos)return'Pierdes tu próximo turno completo.';if(carta.valor>0)return`Avanza ${carta.valor} casillas.`;return`Retrocede ${Math.abs(carta.valor)} casillas.`;}
function prepararCartaVisual(p,carta){
  const modalBox=document.getElementById('cardModalBox'); modalBox.classList.remove('bonus-card','penalty-card');
  document.getElementById('cardType').textContent='CARTA ESPECIAL'; document.getElementById('cardArt').innerHTML='<img src="cartas/carta_reverso.png" alt="Reverso de carta">'; document.getElementById('cardBadge').textContent='CASILLA ESPECIAL';
  document.getElementById('cardDescription').textContent='Gira la ruleta para descubrir la carta.';document.getElementById('cardEffect').textContent='EFECTO: pendiente de revelar';document.getElementById('cardWheel').textContent='?';
}
function revelarCartaVisual(carta){const esBono=carta.tipo==='bono',modalBox=document.getElementById('cardModalBox');modalBox.classList.add(esBono?'bonus-card':'penalty-card');
  document.getElementById('cardType').textContent=esBono?'CARTA DE BONO / AVANCE':'CARTA DE PENALIZACIÓN / OBSTÁCULO';document.getElementById('cardArt').innerHTML=`<img src="${carta.imagen}" alt="${carta.nombre}">`;document.getElementById('cardDescription').textContent=carta.desc;document.getElementById('cardEffect').textContent=`EFECTO: ${efectoCarta(carta)}`;document.getElementById('cardBadge').textContent=esBono?'AVANCE ACADÉMICO':'CONTRATIEMPO ACADÉMICO';}
function waitForHumanRoll(){return new Promise(resolve=>{const rollBtn=document.getElementById('rollBtn');document.getElementById('turnTitle').textContent='Tu turno';document.getElementById('turnMessage').textContent='Presiona el botón para tirar los dados.';document.getElementById('modalDice').textContent='🎲';rollBtn.disabled=false;const finish=()=>{rollBtn.disabled=true;rollBtn.onclick=null;cancelPendingWait=()=>{};resolve();};cancelPendingWait=finish;rollBtn.onclick=finish;showModal('turnModal');});}
async function waitForCardSpin(p,carta){const spinBtn=document.getElementById('spinBtn'),wheel=document.getElementById('cardWheel');prepararCartaVisual(p,carta);document.getElementById('cardMessage').textContent=p.human?'Presiona para girar y descubrir tu carta.':`${p.name} está girando la ruleta...`;spinBtn.disabled=!p.human;showModal('cardModal');
  if(p.human)await new Promise(resolve=>{const finish=()=>{spinBtn.onclick=null;cancelPendingWait=()=>{};resolve();};cancelPendingWait=finish;spinBtn.onclick=finish;});else await sleep(Math.max(delay,700));
  if(!running)return; spinBtn.disabled=true;wheel.classList.add('spinning');const opciones=[...MAZO_BONO,...MAZO_CONTRATIEMPO];
  const cardArt=document.getElementById('cardArt');
  for(let i=0;i<11;i++){
    if(!running){wheel.classList.remove('spinning');return;}
    const cartaVisual=opciones[Math.floor(Math.random()*opciones.length)];
    cardArt.innerHTML=`<img src="${cartaVisual.imagen}" alt="Carta en movimiento">`;
    await sleep(55+i*28);
  }
  wheel.classList.remove('spinning');revelarCartaVisual(carta);await sleep(CARD_RESULT_TIME);hideModal('cardModal');}
function robarCarta(tipo){const mazo=tipo==='bono'?MAZO_BONO:MAZO_CONTRATIEMPO;return {...mazo[Math.floor(Math.random()*mazo.length)],tipo};}
async function aplicarCarta(p,carta){await waitForCardSpin(p,carta);if(carta.esLE)p.jugoLE=true;if(carta.valor)p.pos=Math.max(0,Math.min(META,p.pos+carta.valor));if(carta.turnosPerdidos)p.turnosPerdidos+=carta.turnosPerdidos;renderTokens();if(carta.extraTiros)for(let i=0;i<carta.extraTiros;i++)await moverPorDado(p);}
async function resolverCasilla(p){const pos=p.pos;if(ESCALERAS[pos]){p.pos=ESCALERAS[pos].to;renderTokens();}else if(SERPIENTES[pos]){p.pos=SERPIENTES[pos];renderTokens();}else if(CARD_CELLS.has(pos))await aplicarCarta(p,robarCarta(CARD_TYPES[pos]));}
async function moverPorDado(p){
  if(p.human)await waitForHumanRoll();else{document.getElementById('turnTitle').textContent=`Turno de ${p.name}`;document.getElementById('turnMessage').textContent='El bot está preparando su tirada...';document.getElementById('rollBtn').disabled=true;showModal('turnModal');await sleep(Math.max(delay*2,1500));if(!running)return;hideModal('turnModal');}
  if(!running)return; const dado=Math.floor(Math.random()*6)+1;document.getElementById('diceDisplay').textContent='🎲 '+dado;document.getElementById('modalDice').textContent='🎲 '+dado;document.getElementById('turnTitle').textContent=p.human?'Resultado de tu tirada':`Resultado de ${p.name}`;document.getElementById('turnMessage').textContent=`Salió el número ${dado}.`;showModal('turnModal');await sleep(DICE_RESULT_TIME);if(!running)return;hideModal('turnModal');p.pos=Math.min(META,p.pos+dado);renderTokens();await sleep(BOARD_VIEW_TIME);if(!running)return;await resolverCasilla(p);if(!running)return;await sleep(BOARD_VIEW_TIME);if(dado===6&&p.pos<META){await sleep(delay*.6);if(running)await moverPorDado(p);}}
function puedeGanar(p){return p.pos>=META;}
function setOnlineStatus(message){document.getElementById('onlineStatus').textContent=message;}
function createRoomCode(){return Math.random().toString(36).slice(2,8).toUpperCase();}
function getOnlineName(){return document.getElementById('onlineName').value.trim()||'Jugador';}
function updateOnlinePlayers(data){
  const remotePlayers=data.jugadores||{};
  players=Object.entries(remotePlayers).map(([id,player],index)=>({
    id,name:player.name||`Jugador ${index+1}`,human:id===onlinePlayerId,pos:player.pos||0,turnosPerdidos:0,jugoLE:false,color:player.color||PLAYER_COLORS[index%PLAYER_COLORS.length]
  }));
  renderTokens();
  const total=players.length;
  if(data.status==='finished'){
    document.getElementById('turnInfo').textContent=`🏆 ${data.winner||'La partida'} ganó la partida`;
    hideModal('turnModal');
  }else if(data.status==='playing'){
    const activePlayer=players.find(player=>player.id===data.turn);
    document.getElementById('turnInfo').textContent=`Sala ${onlineRoomId} — turno de ${activePlayer?.name||'otro jugador'}`;
    if(data.turn===onlinePlayerId) showOnlineTurn(); else hideModal('turnModal');
  }else{
    document.getElementById('turnInfo').textContent=`Sala ${onlineRoomId} — esperando jugadores (${total}/2)`;
    hideModal('turnModal');
  }
}
function showOnlineTurn(){
  const rollBtn=document.getElementById('rollBtn');
  document.getElementById('turnTitle').textContent='Tu turno online';
  document.getElementById('turnMessage').textContent='Tira el dado para avanzar.';
  document.getElementById('modalDice').textContent='🎲';
  rollBtn.disabled=false; rollBtn.onclick=rollOnlineTurn; showModal('turnModal');
}
async function rollOnlineTurn(){
  const current=players.find(player=>player.id===onlinePlayerId);
  if(!current||!onlineRoomId)return;
  const rollBtn=document.getElementById('rollBtn'); rollBtn.disabled=true;
  const dice=Math.floor(Math.random()*6)+1;
  let position=Math.min(META,current.pos+dice);
  if(ESCALERAS[position])position=ESCALERAS[position].to;
  if(SERPIENTES[position])position=SERPIENTES[position];
  if(CARD_CELLS.has(position)){
    const card=robarCarta(CARD_TYPES[position]);
    if(card.valor)position=Math.max(0,Math.min(META,position+card.valor));
  }
  const other=players.find(player=>player.id!==onlinePlayerId);
  const changes={};
  changes[`jugadores/${onlinePlayerId}/pos`]=position;
  changes.lastRoll=dice;
  if(position>=META){changes.status='finished';changes.winner=current.name;}
  else if(other)changes.turn=other.id;
  await update(ref(database,`rooms/${onlineRoomId}`),changes);
}
function listenToOnlineRoom(){
  if(onlineUnsubscribe)onlineUnsubscribe();
  onlineUnsubscribe=onValue(ref(database,`rooms/${onlineRoomId}`),snapshot=>{
    if(snapshot.exists())updateOnlinePlayers(snapshot.val());
    else setOnlineStatus('La sala ya no existe.');
  });
}
async function createOnlineRoom(){
  const name=getOnlineName();
  onlineRoomId=createRoomCode();
  onlinePlayerId=push(ref(database,`rooms/${onlineRoomId}/jugadores`)).key;
  await set(ref(database,`rooms/${onlineRoomId}`),{status:'waiting',createdAt:Date.now(),jugadores:{[onlinePlayerId]:{name,pos:0,color:PLAYER_COLORS[0]}}});
  onlineMode=true; running=false; showGameScreen(); buildBoard(); listenToOnlineRoom();
  setOnlineStatus(`Sala creada: ${onlineRoomId}`);
  document.getElementById('turnInfo').textContent=`Sala ${onlineRoomId} — comparte el código con otro jugador`;
}
async function joinOnlineRoom(){
  const code=document.getElementById('roomCode').value.trim().toUpperCase();
  if(code.length<4){setOnlineStatus('Escribe un código de sala válido.');return;}
  const roomSnapshot=await get(ref(database,`rooms/${code}`));
  if(!roomSnapshot.exists()){setOnlineStatus('No se encontró esa sala.');return;}
  const room=roomSnapshot.val();
  if(Object.keys(room.jugadores||{}).length>=2){setOnlineStatus('La sala ya está llena.');return;}
  onlineRoomId=code; onlinePlayerId=push(ref(database,`rooms/${code}/jugadores`)).key;
  const firstPlayerId=Object.keys(room.jugadores||{})[0];
  await update(ref(database,`rooms/${code}`),{status:'playing',turn:firstPlayerId,[`jugadores/${onlinePlayerId}`]:{name:getOnlineName(),pos:0,color:PLAYER_COLORS[1]}});
  onlineMode=true; running=false; showGameScreen(); buildBoard(); listenToOnlineRoom();
}
async function jugar(){let turno=1,ganador=null;while(!ganador&&running){for(const p of players){if(!running)return;document.getElementById('turnInfo').innerHTML=`Turno ${turno} — le toca a <b>${p.name}</b>`;if(p.turnosPerdidos>0){p.turnosPerdidos--;await sleep(delay*.5);continue;}await moverPorDado(p);if(puedeGanar(p)){ganador=p;break;}}turno++;await sleep(delay*.4);}if(ganador){hideModal('turnModal');hideModal('cardModal');document.getElementById('turnInfo').innerHTML='🎉 ¡Partida terminada!';const banner=document.getElementById('winnerBanner');banner.style.display='block';banner.textContent=`🏆 ${ganador.name} se tituló primero y gana el juego!`;running=false;document.getElementById('startBtn').disabled=false;}}
function initPlayers(n){players=[];for(let i=0;i<n;i++)players.push({name:i===0?'Tú':'Bot '+i,human:i===0,pos:0,turnosPerdidos:0,jugoLE:false,color:PLAYER_COLORS[i%PLAYER_COLORS.length]});renderTokens();}
function showGameScreen(){
  document.getElementById('menuScreen').classList.add('hidden');
  document.getElementById('gameScreen').classList.remove('hidden');
}
function showMenuScreen(){
  running=false; cancelPendingWait(); cancelPendingWait=()=>{};
  if(onlineUnsubscribe)onlineUnsubscribe(); onlineUnsubscribe=null; onlineMode=false; onlineRoomId=''; onlinePlayerId='';
  hideModal('turnModal'); hideModal('cardModal');
  document.getElementById('gameScreen').classList.add('hidden');
  document.getElementById('menuScreen').classList.remove('hidden');
  document.getElementById('startBtn').disabled=false;
}
document.getElementById('startBtn').addEventListener('click',async()=>{
  const n=parseInt(document.getElementById('numPlayers').value);
  delay=parseInt(document.getElementById('speed').value);
  document.getElementById('winnerBanner').style.display='none';
  document.getElementById('startBtn').disabled=true;
  showGameScreen(); running=true; initPlayers(n); await jugar();
});
document.getElementById('resetBtn').addEventListener('click',()=>{
  if(onlineMode){
    const resetPlayers={}; players.forEach(player=>{resetPlayers[`jugadores/${player.id}/pos`]=0;});
    update(ref(database,`rooms/${onlineRoomId}`),{...resetPlayers,status:'playing',turn:players[0]?.id||onlinePlayerId,winner:null,lastRoll:null});
    return;
  }
  running=false; hideModal('turnModal'); hideModal('cardModal');
  document.getElementById('winnerBanner').style.display='none';
  document.getElementById('turnInfo').textContent='Preparando la partida...';
  document.getElementById('diceDisplay').textContent='🎲';
  initPlayers(players.length || parseInt(document.getElementById('numPlayers').value));
  running=true; jugar();
});
document.getElementById('menuBtn').addEventListener('click',showMenuScreen);
document.getElementById('botsMode').addEventListener('click',()=>{onlineMode=false;document.getElementById('botsMode').classList.add('selected');document.getElementById('onlineMode').classList.remove('selected');document.getElementById('botSetup').classList.remove('hidden');document.getElementById('onlineSetup').classList.add('hidden');});
document.getElementById('onlineMode').addEventListener('click',()=>{document.getElementById('onlineMode').classList.add('selected');document.getElementById('botsMode').classList.remove('selected');document.getElementById('botSetup').classList.add('hidden');document.getElementById('onlineSetup').classList.remove('hidden');});
document.getElementById('createRoomBtn').addEventListener('click',()=>createOnlineRoom().catch(error=>setOnlineStatus(`No se pudo crear la sala: ${error.message}`)));
document.getElementById('joinRoomBtn').addEventListener('click',()=>joinOnlineRoom().catch(error=>setOnlineStatus(`No se pudo unir: ${error.message}`)));
buildBoard();
