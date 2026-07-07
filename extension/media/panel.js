// Agent Monitor webview script.
// Same rendering engine as the browser panel, but data arrives via VSCode
// postMessage (init / append / reset) instead of fetch + SSE.
const vscode = acquireVsCodeApi();

const CAT = {
  beforeSubmitPrompt:"prompt", afterAgentResponse:"response", afterAgentThought:"thought",
  preToolUse:"tool", postToolUse:"tool", postToolUseFailure:"tool",
  beforeShellExecution:"shell", afterShellExecution:"shell",
  beforeMCPExecution:"mcp", afterMCPExecution:"mcp",
  beforeReadFile:"file", afterFileEdit:"file",
  subagentStart:"subagent", subagentStop:"subagent",
  sessionStart:"lifecycle", sessionEnd:"lifecycle", stop:"lifecycle", preCompact:"lifecycle",
};
const CATS = ["prompt","response","thought","tool","shell","mcp","file","subagent","lifecycle"];
const CATVAR = { prompt:"--c-prompt", response:"--c-response", thought:"--c-thought", tool:"--c-tool",
  shell:"--c-shell", mcp:"--c-mcp", file:"--c-file", subagent:"--c-subagent", lifecycle:"--c-lifecycle", unknown:"--c-lifecycle" };

let events = [];
let seen = new Set();
let view = "tree";
let sessionFilter = "";
let search = "";
let follow = true;
let selectedKey = null;
const catFilter = new Set(CATS);

const $ = (id)=>document.getElementById(id);
function catOf(ev){ return CAT[ev._event] || "unknown"; }
function esc(s){ return String(s==null?"":s); }
function clip(s,n){ s=esc(s).replace(/\s+/g," ").trim(); return s.length>n? s.slice(0,n)+"…" : s; }
function timeOf(ts){ try{ const d=new Date(ts); return d.toLocaleTimeString("en-GB",{hour12:false})+"."+String(d.getMilliseconds()).padStart(3,"0"); }catch{ return ""; } }
function cvar(name){ return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function pick(evs, keys){ for(const e of evs){ for(const k of keys){ if(e[k]!=null && e[k]!=="") return e[k]; } } return undefined; }
function firstWith(evs, keys){ return evs.find(e=>keys.some(k=>e[k]!=null && e[k]!=="")); }

function summarize(ev){
  const c = catOf(ev);
  if(c==="prompt") return clip(ev.prompt,120) || "(prompt)";
  if(c==="response") return clip(ev.text,120) || "(response)";
  if(c==="thought") return clip(ev.text,120) || "(thinking)";
  if(c==="shell") return clip(ev.command,120) || "(shell)";
  if(c==="file") return clip(ev.file_path,120) || "(file)";
  if(c==="mcp") return clip(ev.tool_name||ev.url,120) || "(mcp)";
  if(c==="subagent") return clip((ev.subagent_type?ev.subagent_type+": ":"")+(ev.task||ev.description||ev.summary||""),120) || "(subagent)";
  if(c==="tool") return clip((ev.tool_name?ev.tool_name:"tool")+(ev.tool_input?" "+clip(JSON.stringify(ev.tool_input),80):""),120);
  return ev._event + (ev.reason?" · "+ev.reason:"") + (ev.status?" · "+ev.status:"");
}
function keyOf(ev){ return ev.tool_use_id || ev.subagent_id || (ev._event+"|"+ev._ts+"|"+(ev.generation_id||"")); }

function build(){
  const filtered = events.filter(ev=>{
    if(ev._event==="_ping") return false;
    if(sessionFilter && ev.conversation_id!==sessionFilter) return false;
    if(!catFilter.has(catOf(ev))) return false;
    if(search){ const hay=(ev._event+" "+summarize(ev)).toLowerCase(); if(!hay.includes(search.toLowerCase())) return false; }
    return true;
  });
  const sessions = new Map();
  for(const ev of filtered){
    const cid = ev.conversation_id || "no-conversation";
    if(!sessions.has(cid)) sessions.set(cid,{ cid, model:ev.model||ev.model_id||"", nodes:new Map(), firstTs:ev._ts });
    const S = sessions.get(cid);
    if(ev.model||ev.model_id) S.model = ev.model||ev.model_id;
    const k = keyOf(ev);
    if(!S.nodes.has(k)) S.nodes.set(k,{ key:cid+"::"+k, cat:catOf(ev), gen:ev.generation_id||"", evs:[], firstTs:ev._ts });
    S.nodes.get(k).evs.push(ev);
  }
  return sessions;
}

function nodeState(node){
  const evs = node.evs;
  if(evs.some(e=>e._event==="postToolUseFailure")) return "fail";
  const st = evs.find(e=>e.status)?.status;
  if(st==="error"||st==="aborted"||st==="failed") return "fail";
  const done = evs.some(e=>/^(post|after)|Stop$|^stop$|End$/.test(e._event)) || st==="completed";
  return done? "ok":"run";
}
function nodeDuration(node){
  const d = node.evs.map(e=>e.duration||e.duration_ms).find(x=>typeof x==="number");
  if(typeof d==="number") return d>=1000? (d/1000).toFixed(1)+"s" : d+"ms";
  if(node.evs.length>1){ const t=node.evs.map(e=>+new Date(e._ts)).filter(x=>x); if(t.length>1){ const ms=Math.max(...t)-Math.min(...t); return ms>=1000?(ms/1000).toFixed(1)+"s":ms+"ms"; } }
  return "";
}
function nodeLabel(node){ const base=node.evs.find(e=>summarize(e))||node.evs[0]; return summarize(base); }

function tag(cat, text){
  const t=document.createElement("span"); t.className="tag"; t.textContent=text||cat;
  const col=cvar(CATVAR[cat]||"--c-lifecycle");
  t.style.color=col;
  t.style.background="color-mix(in srgb, "+col+" 12%, white)";
  t.style.borderColor="color-mix(in srgb, "+col+" 28%, white)";
  return t;
}

function render(){
  $("count").textContent = events.filter(e=>e._event!=="_ping").length + " events";
  const list = $("list");
  const atBottom = follow;
  const prevTop = list.scrollTop;
  const sessions = build();
  const frag = document.createDocumentFragment();
  const banner=document.createElement("div"); banner.className="banner"; banner.innerHTML=BANNER; frag.appendChild(banner);

  if(sessions.size===0){
    const e=document.createElement("div"); e.className="empty";
    e.textContent="No events match. Use the Cursor Agent (run a command, read a file, call a tool) — steps stream in live.";
    frag.appendChild(e); list.innerHTML=""; list.appendChild(frag); return;
  }

  if(view==="timeline"){
    const rows=[]; for(const S of sessions.values()) for(const n of S.nodes.values()) for(const ev of n.evs) rows.push(ev);
    rows.sort((a,b)=> new Date(a._ts)-new Date(b._ts));
    const wrap=document.createElement("div"); wrap.className="tl";
    for(const ev of rows) wrap.appendChild(tlRow(ev));
    frag.appendChild(wrap);
  } else {
    for(const S of sessions.values()) frag.appendChild(treeSession(S));
  }
  list.innerHTML=""; list.appendChild(frag);
  if(atBottom) list.scrollTop = list.scrollHeight; else list.scrollTop = prevTop;
}

function tlRow(ev){
  const row=document.createElement("div"); row.className="tlrow";
  const k=(ev.conversation_id||"")+"::ev::"+ev._ts+"::"+ev._event; if(selectedKey===k) row.classList.add("sel");
  const c=catOf(ev);
  const time=document.createElement("span"); time.className="time"; time.textContent=timeOf(ev._ts);
  const lab=document.createElement("span"); lab.className="label"; lab.textContent=summarize(ev);
  row.append(time,tag(c),lab);
  row.onclick=()=>{ selectedKey=k; showDetail([ev], c); render(); };
  return row;
}

function treeSession(S){
  const d=document.createElement("details"); d.className="session"; d.open=true;
  const sm=document.createElement("summary");
  const t=tag("lifecycle","session");
  const name=document.createElement("span"); name.className="sess-id"; name.textContent=S.cid.slice(0,8);
  const model=document.createElement("span"); model.className="sess-model"; model.textContent=S.model?("· "+S.model):"";
  const sp=document.createElement("span"); sp.style.flex="1";
  const cnt=document.createElement("span"); cnt.className="meta"; cnt.textContent=S.nodes.size+" nodes";
  sm.append(t,name,model,sp,cnt); d.appendChild(sm);

  const turns=new Map();
  for(const n of S.nodes.values()){ const g=n.gen||"—"; if(!turns.has(g)) turns.set(g,[]); turns.get(g).push(n); }
  for(const [g,nodes] of turns){
    nodes.sort((a,b)=> new Date(a.firstTs)-new Date(b.firstTs));
    if(g==="—"){ const body=document.createElement("div"); body.className="turn-body"; for(const n of nodes) body.appendChild(nodeEl(n)); d.appendChild(body); continue; }
    const td=document.createElement("details"); td.className="turn"; td.open=true;
    const ts=document.createElement("summary");
    const promptNode=nodes.find(n=>n.cat==="prompt");
    const tt=tag("lifecycle","turn "+g.slice(0,6));
    const tl=document.createElement("span"); tl.className="label"; tl.textContent=promptNode? clip(nodeLabel(promptNode),70):"";
    ts.append(tt,tl); td.appendChild(ts);
    const body=document.createElement("div"); body.className="turn-body";
    for(const n of nodes) body.appendChild(nodeEl(n));
    td.appendChild(body); d.appendChild(td);
  }
  return d;
}

function nodeEl(node){
  const el=document.createElement("div"); el.className="node"; if(selectedKey===node.key) el.classList.add("sel");
  const state=nodeState(node); if(state==="run") el.classList.add("active");
  const st=document.createElement("span"); st.className="st "+state;
  const lab=document.createElement("span"); lab.className="label"; lab.textContent=nodeLabel(node);
  const meta=document.createElement("span"); meta.className="meta"; meta.textContent=nodeDuration(node);
  el.append(st,tag(node.cat),lab,meta);
  el.onclick=()=>{ selectedKey=node.key; showDetail(node.evs, node.cat); render(); };
  return el;
}

/* ---------------- rich detail renderers ---------------- */
function elp(cls, text){ const e=document.createElement("div"); if(cls) e.className=cls; if(text!=null) e.textContent=text; return e; }
function section(title, cat){ const s=elp("d-section"); const h=elp("d-title"); if(cat) h.appendChild(tag(cat)); const sp=document.createElement("span"); sp.textContent=title; h.appendChild(sp); s.appendChild(h); return s; }
function kvBlock(pairs){
  const g=elp("kv");
  for(const [k,v] of pairs){ if(v==null||v==="") continue; g.appendChild(elp("k",k)); const vv=elp("v"); vv.textContent=(typeof v==="object")?JSON.stringify(v):String(v); g.appendChild(vv); }
  return g;
}
function codeBlock(val, cls){ const c=elp(cls||"code"); c.textContent=(typeof val==="object")?JSON.stringify(val,null,2):String(val); return c; }
function diffBlock(text){
  const wrap=elp("diff");
  for(const line of String(text).split("\n")){
    const dl=elp("dl"); dl.textContent=line;
    const c=line[0];
    if(line.startsWith("@@")) dl.classList.add("hunk");
    else if(c==="+"&&!line.startsWith("+++")) dl.classList.add("add");
    else if(c==="-"&&!line.startsWith("---")) dl.classList.add("del");
    else dl.classList.add("ctx");
    wrap.appendChild(dl);
  }
  return wrap;
}
function statusBadge(st){ if(!st) return null; const b=elp("badge",st); b.classList.add(st==="completed"||st==="ok"?"st-ok":(st==="error"||st==="failed"||st==="aborted"?"st-fail":"st-run")); return b; }

function renderRich(evs, cat){
  const out=document.createDocumentFragment();

  if(cat==="prompt"||cat==="response"||cat==="thought"){
    const txt=pick(evs,["prompt","text"]);
    const s=section(cat==="prompt"?"User prompt":cat==="response"?"Agent response":"Agent thinking", cat);
    if(txt!=null){ s.appendChild(elp("prose "+cat, String(txt))); } else { s.appendChild(elp("empty","(no text)")); }
    out.appendChild(s);
  }
  else if(cat==="shell"){
    const cmd=pick(evs,["command"]); const cwd=pick(evs,["cwd"]); const output=pick(evs,["output","stdout","result"]);
    const s=section("Shell command", cat);
    const meta=firstWith(evs,["command"])||evs[0];
    s.appendChild(kvBlock([["cwd",cwd],["exit",meta&&meta.exit_code],["status",pick(evs,["status"])],["duration",fmtDur(evs)]]));
    out.appendChild(s);
    const term=elp("term");
    if(cmd!=null){ const c=elp("cmd"); c.textContent=String(cmd); term.appendChild(c); }
    if(output!=null) term.appendChild(document.createTextNode(typeof output==="object"?JSON.stringify(output,null,2):String(output)));
    else term.appendChild(document.createTextNode("(no output captured)"));
    const os=section("Terminal output", null); os.appendChild(term); out.appendChild(os);
  }
  else if(cat==="file"){
    const fp=pick(evs,["file_path","path"]); const content=pick(evs,["content"]);
    const diff=pick(evs,["diff","patch","unified_diff"]); const edits=pick(evs,["edits","changes"]);
    const s=section(evs.some(e=>e._event==="afterFileEdit")?"File edit":"File read", cat);
    s.appendChild(kvBlock([["path",fp]])); out.appendChild(s);
    if(diff!=null){ const ds=section("Diff", null); ds.appendChild(diffBlock(diff)); out.appendChild(ds); }
    else if(Array.isArray(edits)){
      const ds=section("Edits", null);
      edits.forEach((ed,i)=>{ ds.appendChild(elp("ev-sep","edit #"+(i+1)));
        if(ed.old_string||ed.oldText) ds.appendChild(diffBlock(String(ed.old_string||ed.oldText).split("\n").map(l=>"-"+l).join("\n")));
        if(ed.new_string||ed.newText) ds.appendChild(diffBlock(String(ed.new_string||ed.newText).split("\n").map(l=>"+"+l).join("\n"))); });
      out.appendChild(ds);
    }
    else if(content!=null){ const cs=section("Content", null); cs.appendChild(codeBlock(content)); out.appendChild(cs); }
  }
  else if(cat==="tool"){
    const name=pick(evs,["tool_name"]); const input=pick(evs,["tool_input","input","args"]);
    const output=pick(evs,["tool_output","output","result"]); const failed=evs.some(e=>e._event==="postToolUseFailure");
    const err=pick(evs,["error","error_message","message"]);
    const s=section("Tool · "+(name||"tool"), cat);
    const chipline=elp("chipline"); const sb=statusBadge(failed?"failed":pick(evs,["status"])); if(sb) chipline.appendChild(sb);
    const dur=fmtDur(evs); if(dur){ const db=elp("badge",dur); db.classList.add("st-run"); chipline.appendChild(db); }
    if(chipline.childNodes.length) s.appendChild(chipline);
    out.appendChild(s);
    if(input!=null){ const is=section("Input", null); is.appendChild(codeBlock(input)); out.appendChild(is); }
    if(output!=null){ const os=section("Result", null); os.appendChild(codeBlock(output)); out.appendChild(os); }
    if(failed&&err!=null){ const es=section("Error", null); es.appendChild(codeBlock(err)); out.appendChild(es); }
  }
  else if(cat==="mcp"){
    const name=pick(evs,["tool_name"]); const url=pick(evs,["url","server","server_name"]);
    const input=pick(evs,["tool_input","input","params","arguments"]); const output=pick(evs,["result","output","response"]);
    const s=section("MCP · "+(name||url||"call"), cat);
    s.appendChild(kvBlock([["server",url],["tool",name],["status",pick(evs,["status"])],["duration",fmtDur(evs)]]));
    out.appendChild(s);
    if(input!=null){ const is=section("Input", null); is.appendChild(codeBlock(input)); out.appendChild(is); }
    if(output!=null){ const os=section("Result", null); os.appendChild(codeBlock(output)); out.appendChild(os); }
  }
  else if(cat==="subagent"){
    const type=pick(evs,["subagent_type"]); const model=pick(evs,["model","model_id"]);
    const task=pick(evs,["task","description","summary"]); const status=pick(evs,["status"]);
    const s=section("Subagent · "+(type||""), cat);
    const chipline=elp("chipline"); const sb=statusBadge(status); if(sb) chipline.appendChild(sb);
    if(chipline.childNodes.length) s.appendChild(chipline);
    s.appendChild(kvBlock([
      ["model",model],["task",task],
      ["tool calls",pick(evs,["tool_call_count"])],["messages",pick(evs,["message_count"])],
      ["duration",fmtDur(evs)],["summary",pick(evs,["summary"])]
    ]));
    out.appendChild(s);
    const tpath=pick(evs,["agent_transcript_path"]); const conv=pick(evs,["conversation_id"]); const sid=pick(evs,["subagent_id","tool_call_id"]);
    if(tpath&&conv&&sid){
      const ls=section("Archived transcript", null);
      const file=conv+"/"+String(sid).replace(/[^a-zA-Z0-9._-]/g,"_")+".jsonl";
      const a=document.createElement("a"); a.className="d-link"; a.textContent="open subagent transcript ↗";
      a.onclick=(e)=>{ e.preventDefault(); vscode.postMessage({ type:"openTranscript", file }); };
      ls.appendChild(a);
      const note=elp("meta"," (available only after it was archived)"); ls.appendChild(note);
      out.appendChild(ls);
    }
  }
  else {
    const s=section(esc(evs[0]&&evs[0]._event)||"event", cat);
    s.appendChild(kvBlock([
      ["conversation",pick(evs,["conversation_id"])],["session",pick(evs,["session_id"])],
      ["model",pick(evs,["model","model_id"])],["mode",pick(evs,["composer_mode"])],
      ["status",pick(evs,["status"])],["reason",pick(evs,["reason"])],["loop",pick(evs,["loop_count"])],
    ]));
    out.appendChild(s);
  }
  return out;
}
function fmtDur(evs){ const d=evs.map(e=>e.duration||e.duration_ms).find(x=>typeof x==="number"); if(typeof d!=="number") return ""; return d>=1000?(d/1000).toFixed(1)+"s":d+"ms"; }

function showDetail(evs, cat){
  const body=$("detailBody");
  body.classList.remove("empty"); body.innerHTML="";
  try { body.appendChild(renderRich(evs, cat)); } catch(e){ body.appendChild(elp("empty","(rich render failed, see raw below)")); }

  const raw=document.createElement("details"); raw.className="raw";
  const sm=document.createElement("summary"); sm.textContent="Raw hook events ("+evs.length+")"; raw.appendChild(sm);
  const parts=[];
  evs.slice().sort((a,b)=> new Date(a._ts)-new Date(b._ts)).forEach(ev=>{
    parts.push("── "+ev._event+"  @ "+timeOf(ev._ts)+" ──\n"+JSON.stringify(ev,null,2));
  });
  const pre=document.createElement("pre"); pre.textContent=parts.join("\n\n"); raw.appendChild(pre);
  body.appendChild(raw);
}

/* ---------------- chips / controls ---------------- */
function renderChips(){
  const box=$("chips"); box.innerHTML="";
  for(const c of CATS){
    const chip=document.createElement("button"); chip.className="chip"+(catFilter.has(c)?" on":"");
    const dot=elp("cdot"); dot.style.background=cvar(CATVAR[c]); chip.appendChild(dot);
    chip.appendChild(document.createTextNode(c));
    chip.onclick=()=>{ if(catFilter.has(c)) catFilter.delete(c); else catFilter.add(c); renderChips(); render(); };
    box.appendChild(chip);
  }
}
function setFollow(v){ follow=v; $("followBtn").classList.toggle("on",v); if(v){ const l=$("list"); l.scrollTop=l.scrollHeight; } }
function setFollowUI(v){ follow=v; $("followBtn").classList.toggle("on",v); }
function setConn(live){ const dot=$("dot"), conn=$("conn"); dot.className="dot "+(live?"on":"off"); conn.textContent=live?"live":"waiting"; }

let raf=0;
function scheduleRender(){ if(raf) return; raf=requestAnimationFrame(()=>{ raf=0; render(); }); }

function addEvent(ev){
  if(!ev || ev._event==="_ping") return;
  const sig = JSON.stringify(ev);
  if(seen.has(sig)) return; seen.add(sig);
  events.push(ev);
  if(ev.conversation_id){ const sel=$("session"); if(![...sel.options].some(o=>o.value===ev.conversation_id)){ const o=document.createElement("option"); o.value=ev.conversation_id; o.textContent="session "+ev.conversation_id.slice(0,8); sel.appendChild(o); } }
  scheduleRender();
}

const BANNER = "<b>Captured:</b> every tool call/result, shell, file read+edit, MCP, subagent, prompt, thought, response. "+
  "<b>Not captured</b> (platform limit): the full prompt sent to the LLM, per-token reasoning, raw model API calls, exact token usage.";

window.addEventListener("message",(e)=>{
  const m = e.data || {};
  if(m.type==="init"){
    events=[]; seen=new Set();
    (m.events||[]).forEach(addEvent);
    setConn(true); render();
    const l=$("list"); l.scrollTop=l.scrollHeight;
  } else if(m.type==="append"){
    (m.events||[]).forEach(addEvent);
  } else if(m.type==="reset"){
    events=[]; seen=new Set(); render();
  }
});

$("btnTree").onclick=()=>{ view="tree"; $("btnTree").classList.add("active"); $("btnTl").classList.remove("active"); render(); };
$("btnTl").onclick=()=>{ view="timeline"; $("btnTl").classList.add("active"); $("btnTree").classList.remove("active"); render(); };
$("followBtn").onclick=()=> setFollow(!follow);
$("session").onchange=(e)=>{ sessionFilter=e.target.value; render(); };
$("search").oninput=(e)=>{ search=e.target.value; render(); };
$("chipAll").onclick=()=>{ CATS.forEach(c=>catFilter.add(c)); renderChips(); render(); };
$("chipNone").onclick=()=>{ catFilter.clear(); renderChips(); render(); };
$("list").addEventListener("scroll",()=>{ const l=$("list"); const near=(l.scrollHeight-l.scrollTop-l.clientHeight)<48; if(near!==follow) setFollowUI(near); });

function boot(){ renderChips(); setConn(false); render(); vscode.postMessage({ type:"ready" }); }
boot();
