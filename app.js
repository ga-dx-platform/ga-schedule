// === CONFIG & CONSTANTS ===
const SUPABASE_URL='https://ucentmuxtabrgqgpywts.supabase.co'
const SUPABASE_ANON='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVjZW50bXV4dGFicmdxZ3B5d3RzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczMDM4NjQsImV4cCI6MjA5Mjg3OTg2NH0.BGTAPlKksj2ackf6QPHyfQkDuN35S1qoa0zr91kInRQ'
const db=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON)

// === UTILITY FUNCTIONS ===
async function ensureAuth(){const{data:{session}}=await db.auth.getSession();if(!session){const{error}=await db.auth.signInAnonymously();if(error)console.warn('Auth:',error.message)}}

// === STATE ===
const DEFAULT_SETTINGS={showTextOnBars:true,fontFamily:"'Inter',-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,sans-serif",dateFmt:'DD/MM/YYYY',navBg:'#0F172A',parentColor:'#1E3A8A',childColor:'#4F46E5',todayCol:'#DC2626',wkndBg:'#FEF2F2',wkndTxt:'#DC2626',gridLineCol:'#F3F4F6',holCol:'#FFFBEB',weekendDays:[0,6],statusOverrides:{'Not Started':{color:'#94a3b8',override:false},'In Progress':{color:'#4F46E5',override:false},'Completed':{color:'#059669',override:false},'Delayed':{color:'#D97706',override:false},'On Hold':{color:'#8b5cf6',override:false},'Cancelled':{color:'#DC2626',override:false}},holidays:[],categories:[{name:'General',color:'#5B21B6'},{name:'Develop',color:'#059669'},{name:'Test',color:'#10B981'},{name:'Meeting',color:'#D97706'}]}
const DEFAULT_COL_WIDTHS=[28,20,200,58,58,62,36,44,86,68,60]
let state={settings:Object.assign({},DEFAULT_SETTINGS),projects:[],currentProjectId:null,tasks:[],deps:[],baselines:[],taskLogs:{},comparedBaseline:null,zoom:1,zoomLevel:'day',collapsed:{},editingTaskId:null,holidays:[],colWidths:[...DEFAULT_COL_WIDTHS],searchQuery:'',filterStatus:'',filterCategory:'',filterAssignee:'',skipWeekends:false,currentView:'gantt',calendarYear:new Date().getFullYear(),calendarMonth:new Date().getMonth()}
let isSS=false,dragTaskId=null
let isDraggingBar=false,dragMode=null,dragBarStartX=0,dragBarOrigStart=null,dragBarOrigDur=0,dragBarOrigLeft=0,dragBarOrigWidth=0,dragBarTaskId=null,dragBarEl=null,barWasDragged=false
let colResize={active:false,colIdx:-1,startX:0,startW:0}
let colRafId=null
let lastFocusEl=null,focusStack=[],lastSavedAt=null,confirmCallback=null
// PERF-02: holiday/weekend cache (invalidated whenever settings or holidays change)
let _holidaySet=null,_weekendDays=null
// PERF-01/04: per-render cache (rebuilt at the top of every render() call)
let renderCache=null
// === UNDO/REDO STATE ===
const _history=[],_redoStack=[]
const HISTORY_LIMIT=50
// === BULK SELECTION STATE ===
const selectedTaskIds=new Set()

// === DISPLAY MAPS ===
function getCatColor(catName){const cats=state.settings.categories||DEFAULT_SETTINGS.categories;const found=cats.find(c=>c.name===catName);return found?found.color:'#888888'}
const STATUS_CLASS={'Not Started':'s-none','In Progress':'s-prog',Completed:'s-done',Cancelled:'s-cancel','On Hold':'s-hold',Delayed:'s-delay'}
const STATUS_LABELS={'Not Started':'Not Started','In Progress':'In Progress',Completed:'Completed',Cancelled:'Cancelled','On Hold':'On Hold',Delayed:'Delayed'}

// === DATE & FORMAT HELPERS ===
const pd=s=>new Date(s+'T00:00:00')
const fmtISO=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
const fmt=d=>{const s=fmtISO(d);return`${s.slice(8,10)}-${s.slice(5,7)}-${s.slice(0,4)}`}
const fmtS=d=>{const s=fmtISO(d);return`${s.slice(8,10)}/${s.slice(5,7)}/${s.slice(0,4)}`}
function esc(s){if(s==null)return'';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}

// === CALENDAR & WORKING-DAY LOGIC ===
function addWD(date,n){
  if(n<=1)return new Date(date)
  let d=new Date(date),c=1
  while(c<n){
    d.setDate(d.getDate()+1)
    if(!isNonWorkingDay(d))c++
  }
  return d
}
function taskEnd(t){
  const start=pd(t.start_date)
  const dur=Math.max(1,parseInt(t.duration_days)||1)
  return addWD(start,dur)
}

function getHolidaySet(){
  if(!_holidaySet){
    _holidaySet=new Set([...(state.holidays||[]).map(h=>h.date),...((state.settings.holidays||[]).map(h=>h.date))])
    _weekendDays=new Set(state.settings.weekendDays||[0,6])
  }
  return{holidaySet:_holidaySet,weekendDays:_weekendDays}
}
function invalidateCalendarCache(){_holidaySet=null;_weekendDays=null}
function isNonWorkingDay(date){
  const{holidaySet,weekendDays}=getHolidaySet()
  return weekendDays.has(date.getDay())||holidaySet.has(fmtISO(date))
}
function nextWorkingDayAfter(date){
  if(!state.skipWeekends){
    const d=new Date(date)
    d.setDate(d.getDate()+1)
    return d
  }
  const d=new Date(date)
  do{d.setDate(d.getDate()+1)}while(isNonWorkingDay(d))
  return d
}
function calcTaskEndFromStart(startDate,duration){
  return addWD(new Date(startDate),Math.max(1,parseInt(duration)||1))
}
// === STATE MANAGEMENT ===
function cascadeDates(taskId,changedMap=new Map(),visited=new Set()){
  if(visited.has(taskId))return changedMap
  visited.add(taskId)
  const sourceTask=state.tasks.find(t=>t.id===taskId)
  if(!sourceTask)return changedMap

  const sourceEnd=taskEnd(sourceTask)
  const links=state.deps.filter(link=>link.from_task_id===taskId&&(link.dep_type||'FS')==='FS')
  links.forEach(link=>{
    const targetTask=state.tasks.find(t=>t.id===link.to_task_id)
    if(!targetTask)return
    if(targetTask.locked)return

    const nextStart=nextWorkingDayAfter(sourceEnd)
    const nextStartIso=fmtISO(nextStart)
    const prevStart=targetTask.start_date

    if(prevStart!==nextStartIso){
      targetTask.start_date=nextStartIso
      targetTask.duration_days=Math.max(1,parseInt(targetTask.duration_days)||1)
      changedMap.set(targetTask.id,{id:targetTask.id,start_date:targetTask.start_date,duration_days:targetTask.duration_days})
      cascadeDates(targetTask.id,changedMap,visited)
    }
  })
  return changedMap
}
async function persistCascadedTasks(changedMap){
  const changed=[...changedMap.values()]
  if(!changed.length)return
  const updates=changed.map(t=>db.from('tasks').update({start_date:t.start_date,duration_days:t.duration_days}).eq('id',t.id))
  const results=await Promise.all(updates)
  const failed=results.find(r=>r.error)
  if(failed)throw new Error(failed.error.message)
}

function getParentDates(taskId){
  if(renderCache&&renderCache.parentDatesCache.has(taskId))return renderCache.parentDatesCache.get(taskId)
  const cm=renderCache?.childMap,tb=renderCache?.taskById
  const children=cm?cm.get(taskId)||[]:state.tasks.filter(c=>c.parent_id===taskId)
  if(!children.length){const t=tb?tb.get(taskId):state.tasks.find(t=>t.id===taskId);return t?{s:pd(t.start_date),e:taskEnd(t)}:null}
  let minS=null,maxE=null
  children.forEach(c=>{const d=getParentDates(c.id);if(!d)return;if(!minS||d.s<minS)minS=d.s;if(!maxE||d.e>maxE)maxE=d.e})
  return{s:minS,e:maxE}
}
function getPxPerDay(){
  if(state.zoomLevel==='month')return 3;
  if(state.zoomLevel==='week')return 10;
  return 30;
}
function getROW_H(){return Math.max(40,Math.round(window.innerHeight*0.048))}

function getMinMax(){
  let min=null,max=null
  const all=[...state.tasks,...(state.comparedBaseline?.tasks||[])]
  all.forEach(t=>{if(!t?.start_date)return;const s=pd(t.start_date),e=taskEnd(t);if(!min||s<min)min=s;if(!max||e>max)max=e})
  if(!min){min=new Date();max=new Date();max.setDate(max.getDate()+30)}
  const a=new Date(min);a.setDate(a.getDate()-3)
  const b=new Date(max);b.setDate(b.getDate()+7)
  return{min:a,max:b}
}
function dBetween(a,b){return Math.round((b-a)/86400000)}

function rollupPct(id){
  if(renderCache&&renderCache.pctCache.has(id))return renderCache.pctCache.get(id)
  const cm=renderCache?.childMap,tb=renderCache?.taskById
  const ch=cm?cm.get(id)||[]:state.tasks.filter(t=>t.parent_id===id)
  if(!ch.length)return (tb?tb.get(id):state.tasks.find(t=>t.id===id))?.progress_pct||0
  return Math.round(ch.reduce((s,c)=>s+rollupPct(c.id),0)/ch.length)
}
function buildRenderCache(){
  // Build lookup maps once per render; large projects otherwise pay repeated
  // find/filter costs across the task list, Gantt, and dependency badges.
  const taskById=new Map()
  const childMap=new Map()
  state.tasks.forEach(t=>{
    taskById.set(t.id,t)
    const pid=t.parent_id||null
    if(!childMap.has(pid))childMap.set(pid,[])
    childMap.get(pid).push(t)
  })
  childMap.forEach(children=>children.sort((a,b)=>(a.sort_order??0)-(b.sort_order??0)))
  const depsByToTaskId=new Map()
  state.deps.forEach(dep=>{
    if(!depsByToTaskId.has(dep.to_task_id))depsByToTaskId.set(dep.to_task_id,[])
    depsByToTaskId.get(dep.to_task_id).push(dep)
  })
  // Pre-compute rollup % for every task with memoization (O(n) total)
  const pctCache=new Map()
  function computePct(id){
    if(pctCache.has(id))return pctCache.get(id)
    const ch=childMap.get(id)||[]
    const pct=ch.length
      ?Math.round(ch.reduce((s,c)=>s+computePct(c.id),0)/ch.length)
      :(taskById.get(id)?.progress_pct||0)
    pctCache.set(id,pct)
    return pct
  }
  state.tasks.forEach(t=>computePct(t.id))
  // Pre-compute parent date spans (min start / max end) for every parent task
  const parentDatesCache=new Map()
  function computeParentDates(taskId){
    if(parentDatesCache.has(taskId))return parentDatesCache.get(taskId)
    const children=childMap.get(taskId)||[]
    let result
    if(!children.length){
      const t=taskById.get(taskId)
      result=t?{s:pd(t.start_date),e:taskEnd(t)}:null
    }else{
      let minS=null,maxE=null
      children.forEach(c=>{const d=computeParentDates(c.id);if(!d)return;if(!minS||d.s<minS)minS=d.s;if(!maxE||d.e>maxE)maxE=d.e})
      result={s:minS,e:maxE}
    }
    parentDatesCache.set(taskId,result)
    return result
  }
  // Only pre-warm tasks that actually have children (leaf tasks fall back cheaply)
  state.tasks.filter(t=>childMap.has(t.id)).forEach(t=>computeParentDates(t.id))
  return{taskById,childMap,depsByToTaskId,pctCache,parentDatesCache,wbsCache:null,visibleCache:null}
}
function getDerivedStatus(task,actualPct){
  const overrideStatuses=['Cancelled','On Hold','Delayed']
  if(overrideStatuses.includes(task.status))return task.status
  if(actualPct===100)return'Completed'
  if(actualPct>0)return'In Progress'
  return'Not Started'
}
function getWBS(){
  if(renderCache?.wbsCache)return renderCache.wbsCache
  const wbs={},ri={};let cnt=0
  const childMap=renderCache?.childMap
  function childrenOf(pid){return childMap?(childMap.get(pid)||[]):state.tasks.filter(t=>(t.parent_id||null)===pid).sort((a,b)=>(a.sort_order??0)-(b.sort_order??0))}
  function walk(pid,pre){childrenOf(pid).forEach((t,i)=>{const w=pre+(i+1);wbs[t.id]=w;ri[t.id]=++cnt;walk(t.id,w+'.')})}
  walk(null,'')
  const result={wbs,ri}
  if(renderCache)renderCache.wbsCache=result
  return result
}
function getVisible(){
  if(renderCache?.visibleCache)return renderCache.visibleCache
  const vis=[]
  const childMap=renderCache?.childMap
  function childrenOf(pid){return childMap?(childMap.get(pid)||[]):state.tasks.filter(t=>(t.parent_id||null)===pid).sort((a,b)=>(a.sort_order??0)-(b.sort_order??0))}
  function walk(pid,lv){childrenOf(pid).forEach(t=>{vis.push({task:t,level:lv});if(!state.collapsed[t.id])walk(t.id,lv+1)})}
  walk(null,0)
  if(renderCache)renderCache.visibleCache=vis
  return vis
}
function getFilteredVisible(){
  const q=state.searchQuery,fs=state.filterStatus,fc=state.filterCategory,fa=state.filterAssignee
  if(!q&&!fs&&!fc&&!fa)return getVisible()
  const taskById=renderCache?.taskById
  const matchIds=new Set()
  state.tasks.forEach(t=>{
    if(q&&!((t.name||'').toLowerCase().includes(q)||(t.assignee||'').toLowerCase().includes(q)||(t.status||'').toLowerCase().includes(q)||(t.category||'').toLowerCase().includes(q)))return
    if(fs&&t.status!==fs)return
    if(fc&&t.category!==fc)return
    if(fa&&(t.assignee||'')!==fa)return
    matchIds.add(t.id)
  })
  const visIds=new Set(matchIds)
  function addAncestors(id){const t=taskById?taskById.get(id):state.tasks.find(x=>x.id===id);if(t&&t.parent_id&&!visIds.has(t.parent_id)){visIds.add(t.parent_id);addAncestors(t.parent_id)}}
  matchIds.forEach(id=>addAncestors(id))
  return getVisible().filter(({task})=>visIds.has(task.id))
}
let _searchTimer=null
function handleSearch(query){
  state.searchQuery=query.toLowerCase()
  clearTimeout(_searchTimer)
  _searchTimer=setTimeout(()=>render(),150)
}
function applyFilter(type,value){
  if(type==='status')state.filterStatus=value
  if(type==='category')state.filterCategory=value
  if(type==='assignee')state.filterAssignee=value
  updateFilterClearBtn()
  render()
}
function clearFilters(){
  state.filterStatus=state.filterCategory=state.filterAssignee=''
  const fs=document.getElementById('filter-status'),fc=document.getElementById('filter-category'),fa=document.getElementById('filter-assignee')
  if(fs)fs.value='';if(fc)fc.value='';if(fa)fa.value=''
  updateFilterClearBtn()
  render()
}
function updateFilterClearBtn(){
  const btn=document.getElementById('filter-clear')
  const hasFilter=!!(state.filterStatus||state.filterCategory||state.filterAssignee)
  if(btn)btn.classList.toggle('hidden-clear',!hasFilter)
  const badge=document.getElementById('filter-badge')
  if(badge){
    let count=0
    if(state.filterStatus)count++
    if(state.filterCategory)count++
    if(state.filterAssignee)count++
    badge.textContent=count
    badge.style.display=count>0?'inline-block':'none'
  }
}
function toggleFilterPopup(){
  const popup=document.getElementById('filter-popup')
  if(popup)popup.classList.toggle('hidden')
}
document.addEventListener('click',e=>{
  const filterContainer=e.target.closest('.filter-container')
  const popup=document.getElementById('filter-popup')
  if(!filterContainer&&popup&&!popup.classList.contains('hidden')){
    popup.classList.add('hidden')
  }
})
function populateAssigneeFilter(){
  const sel=document.getElementById('filter-assignee')
  if(!sel)return
  const assignees=[...new Set(state.tasks.map(t=>t.assignee).filter(Boolean))].sort()
  const cur=state.filterAssignee
  sel.innerHTML='<option value="">All Assignee</option>'+assignees.map(a=>`<option value="${esc(a)}"${a===cur?' selected':''}>${esc(a)}</option>`).join('')
}

function populateCategoryDropdowns(){
  const cats=state.settings.categories||DEFAULT_SETTINGS.categories
  const modalSel=document.getElementById('t-category')
  const filterSel=document.getElementById('filter-category')
  if(modalSel){
    const cur=modalSel.value
    modalSel.innerHTML=cats.map(c=>`<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('')
    if(cur&&cats.some(c=>c.name===cur))modalSel.value=cur
    else if(cats.length)modalSel.value=cats[0].name
  }
  if(filterSel){
    const cur=filterSel.value
    filterSel.innerHTML=`<option value="">All Category</option>`+cats.map(c=>`<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('')
    if(cur&&cats.some(c=>c.name===cur))filterSel.value=cur
  }
}

function renderCategorySettingsList(){
  const tbody=document.getElementById('category-settings-body')
  if(!tbody)return
  const cats=state.settings.categories||DEFAULT_SETTINGS.categories
  tbody.innerHTML=cats.map((c,i)=>`
    <tr>
      <td style="font-size:13px;color:var(--txt2)">${esc(c.name)}</td>
      <td><input type="color" value="${c.color}" onchange="updateCategoryColor(${i},this.value)" style="width:100%;height:24px;border:none;padding:0;cursor:pointer;background:transparent;"></td>
      <td style="text-align:center"><button class="act del" onclick="removeCategory(${i})" title="Remove">🗑</button></td>
    </tr>`).join('')
}

function addCategory(){
  const nameEl=document.getElementById('new-cat-name')
  const colorEl=document.getElementById('new-cat-color')
  const name=nameEl.value.trim()
  if(!name){toast('⚠️ Enter a category name');return}
  if(!state.settings.categories)state.settings.categories=[...DEFAULT_SETTINGS.categories]
  if(state.settings.categories.some(c=>c.name.toLowerCase()===name.toLowerCase())){toast('⚠️ Category already exists');return}
  state.settings.categories.push({name,color:colorEl.value})
  nameEl.value=''
  renderCategorySettingsList()
  populateCategoryDropdowns()
  render()
  toast('✅ Category added')
}

function updateCategoryColor(index,newColor){
  if(state.settings.categories&&state.settings.categories[index]){
    state.settings.categories[index].color=newColor
    populateCategoryDropdowns()
    render()
  }
}

function removeCategory(index){
  if(state.settings.categories&&state.settings.categories.length>1){
    state.settings.categories.splice(index,1)
    renderCategorySettingsList()
    populateCategoryDropdowns()
    render()
    toast('🗑 Category removed')
  }else{
    toast('⚠️ You must have at least one category.')
  }
}

function customPrompt(title,defaultValue=''){
  return new Promise(resolve=>{
    const overlay=document.getElementById('custom-prompt-overlay')
    const titleEl=document.getElementById('custom-prompt-title')
    const inputEl=document.getElementById('custom-prompt-input')
    const btnConfirm=document.getElementById('custom-prompt-confirm')
    const btnCancel=document.getElementById('custom-prompt-cancel')
    if(!overlay||!titleEl||!inputEl||!btnConfirm||!btnCancel){resolve(null);return}

    titleEl.textContent=title
    inputEl.value=defaultValue
    rememberFocus()
    overlay.classList.remove('hidden')
    overlay.classList.add('show')
    overlay.setAttribute('aria-hidden','false')
    inputEl.focus()
    inputEl.select()

    const cleanup=()=>{
      overlay.classList.remove('show')
      overlay.classList.add('hidden')
      overlay.setAttribute('aria-hidden','true')
      restoreFocus()
      btnConfirm.removeEventListener('click',onConfirm)
      btnCancel.removeEventListener('click',onCancel)
      overlay.removeEventListener('click',onOverlayClick)
      inputEl.removeEventListener('keydown',onKeydown)
    }
    const onConfirm=()=>{cleanup();resolve(inputEl.value.trim())}
    const onCancel=()=>{cleanup();resolve(null)}
    const onOverlayClick=e=>{if(e.target===overlay)onCancel()}
    const onKeydown=e=>{
      if(e.key==='Enter')onConfirm()
      if(e.key==='Escape')onCancel()
    }

    btnConfirm.addEventListener('click',onConfirm)
    btnCancel.addEventListener('click',onCancel)
    overlay.addEventListener('click',onOverlayClick)
    inputEl.addEventListener('keydown',onKeydown)
  })
}

// === API / DATABASE ===
async function loadProjects(){
  const{data,error}=await db.from('projects').select('*').order('created_at')
  if(error){toast('❌ Failed to load projects');return}
  state.projects=data||[]
  renderSidebarProjects()
}
async function loadTasks(){
  if(!state.currentProjectId)return
  setSS('⟳ Loading...')
  const{data,error}=await db.from('tasks').select('*').eq('project_id',state.currentProjectId).order('sort_order')
  if(error){toast('❌ Failed to load tasks');return}
  state.tasks=data||[]
  setSS('✓ Synced')
}
async function loadHolidays(){
  const{data,error}=await db.from('thai_holidays').select('date').eq('year',new Date().getFullYear())
  if(error){console.warn('Failed to load holidays:',error.message);return}
  state.holidays=data||[]
  invalidateCalendarCache()
}
async function loadDeps(){
  if(!state.currentProjectId)return
  const{data,error}=await db.from('dependencies').select('*').eq('project_id',state.currentProjectId)
  if(error){toast('❌ Failed to load dependencies');console.error(error.message);return}
  state.deps=data||[]
}
async function loadBaselines(){
  if(!state.currentProjectId)return
  const{data,error}=await db.from('baselines').select('*').eq('project_id',state.currentProjectId).order('created_at',{ascending:false})
  if(error){console.warn('Failed to load baselines:',error.message);return}
  state.baselines=data||[]
}
async function loadTaskLogs(){
  if(!state.currentProjectId)return
  const{data,error}=await db.from('task_logs').select('*').eq('project_id',state.currentProjectId).order('logged_at',{ascending:false})
  if(error){console.warn('loadTaskLogs:',error.message);return}
  const map={}
  ;(data||[]).forEach(log=>{
    if(!map[log.task_id])map[log.task_id]=[]
    map[log.task_id].push(log)
  })
  state.taskLogs=map
}

// === UI RENDERING ===
function _setEmptyState(el,noProject,noResults,hasFilter){
  if(noProject){
    el.innerHTML=`
      <div class="es-icon" style="background:#F1F5F9"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 7l5-5h10l5 5v13H2V7z"/><polyline points="2,7 12,13 22,7"/></svg></div>
      <h3 class="es-title">Select a project to get started</h3>
      <p class="es-desc">Choose an existing project from the top menu, or create a new one to begin planning.</p>
      <button onclick="openProjModal()" class="es-btn">Open Projects</button>`
    return
  }
  if(noResults&&hasFilter){
    el.innerHTML=`
      <div class="es-icon" style="background:#FFF7ED"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg></div>
      <h3 class="es-title">No tasks match your filters</h3>
      <p class="es-desc">Try adjusting the search or filter criteria, or clear all filters to see every task.</p>
      <button onclick="clearFilters();document.getElementById('search-box').value='';handleSearch('')" class="es-btn">Clear Filters</button>`
    return
  }
  el.innerHTML=`
    <div class="es-icon" style="background:#F8FAFC"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div>
    <h3 class="es-title">No tasks in this project yet</h3>
    <p class="es-desc">Get started by creating your first task to keep your project timeline on track.</p>
    <button onclick="openAddModal()" class="es-btn">Add First Task</button>`
}
function render(){
  renderCache=buildRenderCache()
  const RH=getROW_H()
  document.documentElement.style.setProperty('--row-h',RH+'px')
  renderLegend()
  populateAssigneeFilter()
  renderBulkBar()

  const hasFilter=!!(state.searchQuery||state.filterStatus||state.filterCategory||state.filterAssignee)
  const noProject=!state.currentProjectId
  const noTasks=state.tasks.length===0
  const noResults=!noTasks&&state.currentView==='gantt'&&getFilteredVisible().length===0
  const isEmpty=noProject||noTasks||noResults
  const emptyEl=document.getElementById('empty-state-container')
  const activeView=document.getElementById('view-'+state.currentView)
  if(isEmpty){
    if(emptyEl){
      emptyEl.classList.remove('hidden');emptyEl.style.display='flex'
      _setEmptyState(emptyEl,noProject,noResults,hasFilter)
    }
    if(activeView)activeView.style.display='none'
    renderSB()
    return
  }
  if(emptyEl){emptyEl.classList.add('hidden');emptyEl.style.display='none'}
  if(activeView)activeView.style.display=VIEW_DISPLAY[state.currentView]||''

  if(state.currentView==='gantt'){
    renderTaskList()
    renderGantt(RH)
  } else if(state.currentView==='kanban'){
    renderKanban()
  } else if(state.currentView==='calendar'){
    renderCalendar()
  } else if(state.currentView==='dashboard'){
    renderDashboard()
  }
  renderSB()
}

function renderLegend(){
  const cats=[...new Set(state.tasks.map(t=>t.category))]
  document.getElementById('nav-legend').innerHTML=cats.map(c=>`<div class="nleg"><div class="nleg-dot" style="background:${getCatColor(c)}"></div>${c}</div>`).join('')
}

function renderTaskList(){
  renderColHdr()
  const{wbs,ri}=getWBS(),visible=getFilteredVisible()
  const visIdxMap=new Map(visible.map(({task},i)=>[task.id,i+1]))
  const childMap=renderCache?.childMap
  const depsByToTaskId=renderCache?.depsByToTaskId
  const tl=document.getElementById('task-list');tl.innerHTML=''
  const frag=document.createDocumentFragment()
  visible.forEach(({task:t,level})=>{
    const hasKids=childMap?childMap.has(t.id):state.tasks.some(c=>c.parent_id===t.id)
    const{s:rs,e:re}=hasKids?(getParentDates(t.id)||{s:pd(t.start_date),e:taskEnd(t)}):{s:pd(t.start_date),e:taskEnd(t)}
    const e=re,pct=hasKids?rollupPct(t.id):t.progress_pct
    const displayStatus=getDerivedStatus(t,pct)
    const sc=STATUS_CLASS[displayStatus]||'s-none'
    const ov=(state.settings.statusOverrides||{})[displayStatus]
    const badgeStyle=(ov&&ov.override&&ov.color)?`background:${ov.color}22;color:${ov.color};border:1px solid ${ov.color}44`:''
    const preds=(depsByToTaskId?depsByToTaskId.get(t.id)||[]:state.deps.filter(d=>d.to_task_id===t.id)).map(d=>visIdxMap.get(d.from_task_id)).filter(Boolean)
    const isCan=t.status==='Cancelled'
    const row=document.createElement('div')
    row.className=`trow${hasKids?' is-parent':''}${state.editingTaskId===t.id?' is-selected':''}${isCan?' is-cancelled':''}${selectedTaskIds.has(t.id)?' is-bulk-selected':''}`
    row.dataset.id=t.id;row.dataset.taskId=t.id;row.dataset.parentId=t.parent_id||'';row.draggable=true;row.tabIndex=0;row.setAttribute('role','button');row.setAttribute('aria-label',`Edit task ${esc(t.name)}`)
    row.innerHTML=`
      <span class="r-num"><span class="rn-num">${ri[t.id]||''}</span><input type="checkbox" class="row-chk" data-checkid="${t.id}"${selectedTaskIds.has(t.id)?' checked':''} onclick="event.stopPropagation();toggleTaskSelection('${t.id}')"></span>
      <span class="r-exp" data-id="${t.id}">${hasKids?(state.collapsed[t.id]?'▶':'▼'):''}</span>
      <span class="r-name ${hasKids?'parent':'child'}${isCan?' cancelled':''}" style="padding-left:${level*12+2}px">
        <span class="drag-handle" title="Drag to reorder">⠿</span>
        ${t.type==='milestone'?'<span class="ms-icon">◆</span>':''}
        <span class="lbl" title="Double-click to rename" onclick="event.stopPropagation();openDetailPanel('${t.id}')" ondblclick="event.stopPropagation();inlineEditName(this,'${t.id}')">${esc(t.name)}</span>
        ${t.locked?'<span class="lock-ind" title="Locked task" aria-label="Locked task">🔒</span>':''}
        ${preds.length?`<span class="dep-count" title="Predecessors: rows ${preds.join(', ')}">${preds.join(',')}</span>`:''}
      </span>
      <span class="r-date">${fmtS(rs)}</span>
      <span class="r-date">${t.type==='milestone'?'—':fmtS(e)}</span>
      <span class="r-date">${esc(t.assignee||'—')}</span>
      <span class="r-dur">${t.type==='milestone'?'—':t.duration_days+'d'}</span>
      <span class="r-pct${hasKids?' par':''}${!hasKids?' pct-editable':''}" style="color:${pct===100?'var(--green)':pct>0?'#3B00FF':'var(--txt3)'}">
        <span${!hasKids?` ondblclick="inlineEditPct(this,'${t.id}')" onclick="event.stopPropagation()" title="Double-click to edit"`:''}>${pct}%</span>
        ${hasKids?`<span class="pbar"><span class="pbar-fill" style="width:${pct}%"></span></span>`:''}
      </span>
      <span><span class="sbadge ${sc}" style="${badgeStyle}" ondblclick="inlineEditStatus(this,'${t.id}')" onclick="event.stopPropagation()" title="Double-click to change status">${esc(STATUS_LABELS[displayStatus]||displayStatus)}</span></span>
      <span class="cat-cell">
        <div class="cat-dot" style="background:${getCatColor(t.category)}"></div>
        <span class="cat-lbl">${esc(t.category||'General')}</span>
      </span>
      <span class="acts">
        <button class="act" data-edit="${t.id}" title="Edit" aria-label="Edit ${esc(t.name)}">✎</button>
        <button class="act del" data-del="${t.id}" title="Delete" aria-label="Delete ${esc(t.name)}">🗑</button>
      </span>`
    frag.appendChild(row)
  })
  tl.appendChild(frag)
  const qaBtn=document.createElement('div')
  qaBtn.className='quick-add-btn'
  qaBtn.setAttribute('data-html2canvas-ignore','true')
  qaBtn.innerHTML='<i class="fas fa-plus"></i> Add New Task'
  qaBtn.onclick=()=>openTaskModal(null)
  tl.appendChild(qaBtn)
  tl.onclick=e=>{
    const exp=e.target.closest('[data-id]');if(exp&&exp.classList.contains('r-exp')){state.collapsed[exp.dataset.id]=!state.collapsed[exp.dataset.id];render();return}
    const eb=e.target.closest('[data-edit]');if(eb){openEditModal(eb.dataset.edit);return}
    const db2=e.target.closest('[data-del]');if(db2){confirmDelete(db2.dataset.del);return}
    const rw=e.target.closest('.trow')
    if(rw){if(selectedTaskIds.size>0){toggleTaskSelection(rw.dataset.id);return}openEditModal(rw.dataset.id)}
  }
  tl.querySelectorAll('.trow').forEach(row=>{
    row.onkeydown=e=>{
      if(e.key==='Enter'||e.key===' '){e.preventDefault();openEditModal(row.dataset.id)}
      if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10')){
        e.preventDefault()
        const rect=row.getBoundingClientRect()
        showTaskContextMenu(row.dataset.id,rect.left+24+window.scrollX,rect.top+Math.min(rect.height-4,24)+window.scrollY)
      }
    }
    row.ondragstart=e=>{dragTaskId=row.dataset.id;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',dragTaskId)}
    row.ondragend=()=>{dragTaskId=null;tl.querySelectorAll('.trow.drag-over').forEach(el=>el.classList.remove('drag-over','drag-over-before','drag-over-after'))}
    row.ondragover=e=>{
      if(!dragTaskId||dragTaskId===row.dataset.id)return
      const dr=tl.querySelector(`.trow[data-id="${dragTaskId}"]`);if(!dr)return
      if((dr.dataset.parentId||'')!==(row.dataset.parentId||''))return
      e.preventDefault()
      const rect=row.getBoundingClientRect(),pa=e.clientY>rect.top+rect.height/2
      tl.querySelectorAll('.trow.drag-over').forEach(el=>{if(el!==row)el.classList.remove('drag-over','drag-over-before','drag-over-after')})
      row.classList.add('drag-over');row.classList.toggle('drag-over-before',!pa);row.classList.toggle('drag-over-after',pa)
    }
    row.ondragleave=()=>row.classList.remove('drag-over','drag-over-before','drag-over-after')
    row.ondrop=async e=>{
      e.preventDefault();row.classList.remove('drag-over','drag-over-before','drag-over-after')
      if(!dragTaskId||dragTaskId===row.dataset.id)return
      const dr=tl.querySelector(`.trow[data-id="${dragTaskId}"]`);if(!dr)return
      if((dr.dataset.parentId||'')!==(row.dataset.parentId||'')){toast('⚠️ Can only reorder tasks at the same level');return}
      await reorderTasks(dragTaskId,row.dataset.id,e.clientY>row.getBoundingClientRect().top+row.getBoundingClientRect().height/2)
    }
  })
  applyColumnWidths()
}

async function reorderTasks(dragId,targetId,placeAfter){
  const dt=state.tasks.find(t=>t.id===dragId),tt=state.tasks.find(t=>t.id===targetId)
  if(!dt||!tt||(dt.parent_id||null)!==(tt.parent_id||null))return
  const pid=tt.parent_id||null
  const sibs=state.tasks.filter(t=>(t.parent_id||null)===pid).sort((a,b)=>(a.sort_order??0)-(b.sort_order??0))
  const fi=sibs.findIndex(t=>t.id===dragId),ti=sibs.findIndex(t=>t.id===targetId)
  if(fi<0||ti<0||fi===ti)return
  const[mv]=sibs.splice(fi,1);let ii=ti;if(fi<ti)ii--;if(placeAfter)ii++;sibs.splice(ii,0,mv)
  sibs.forEach((t,i)=>{const r=state.tasks.find(x=>x.id===t.id);if(r)r.sort_order=(i+1)*10})
  setSS('⟳ Updating order...')
  const res=await Promise.all(sibs.map((t,i)=>db.from('tasks').update({sort_order:(i+1)*10}).eq('id',t.id)))
  if(res.find(r=>r.error)){toast('❌ Failed to update order');await loadTasks()}else toast('✅ Order updated')
  setSS('✓ Synced');render()
}

function renderGantt(RH){
  RH=RH||getROW_H()
  const DP=getPxPerDay()
  const BCH=Math.max(22,Math.round(RH*0.65))
  const BPH=Math.max(8,Math.round(RH*0.22))
  const BMS=Math.max(12,Math.round(RH*0.36))
  const visible=getFilteredVisible()
  const childMap=renderCache?.childMap
  const{min,max}=getMinMax()
  const bMap=new Map((state.comparedBaseline?.tasks||[]).map(t=>[t.id,t]))
  const totalDays=dBetween(min,max)+1
  const W=totalDays*DP,today=new Date()

  const gh=document.getElementById('gantt-hdr');gh.innerHTML='';gh.style.width=W+'px'
  const mr=document.createElement('div');mr.className='g-month-row'
  const dr=document.createElement('div');dr.className='g-day-row'

  if(state.zoomLevel==='day'){
    let cur=new Date(min),cm='',cpx=0
    for(let i=0;i<totalDays;i++){
      const mLabel=cur.toLocaleString('en',{month:'short'})+' '+cur.getFullYear()
      if(mLabel!==cm){
        if(cm){const el=document.createElement('div');el.className='g-month';el.style.width=cpx+'px';el.textContent=cm;mr.appendChild(el)}
        cm=mLabel;cpx=0
      }
      cpx+=DP
      const wd=state.settings.weekendDays||[0,6]
      const isWE=wd.includes(cur.getDay()),isTd=cur.toDateString()===today.toDateString()
      const isHol=(state.settings.holidays||[]).some(h=>h.date===fmtISO(cur))
      const dc=document.createElement('div');dc.className='g-day';dc.style.width=DP+'px';dc.textContent=cur.getDate()
      if(isWE||isHol)dc.classList.add('weekend')
      if(isTd)dc.classList.add('today-d')
      dr.appendChild(dc);cur.setDate(cur.getDate()+1)
    }
    if(cm){const el=document.createElement('div');el.className='g-month';el.style.width=cpx+'px';el.textContent=cm;mr.appendChild(el)}

  } else if(state.zoomLevel==='week'){
    let cur=new Date(min),cm='',cpx=0
    for(let i=0;i<totalDays;i++){
      const mLabel=cur.toLocaleString('en',{month:'short'})+' '+cur.getFullYear()
      if(mLabel!==cm){
        if(cm){const el=document.createElement('div');el.className='g-month';el.style.width=cpx+'px';el.textContent=cm;mr.appendChild(el)}
        cm=mLabel;cpx=0
      }
      cpx+=DP;cur.setDate(cur.getDate()+1)
    }
    if(cm){const el=document.createElement('div');el.className='g-month';el.style.width=cpx+'px';el.textContent=cm;mr.appendChild(el)}
    let wCur=new Date(min),wOff=0
    while(wOff<totalDays){
      const colDays=Math.min(7,totalDays-wOff),colW=colDays*DP
      const wc=document.createElement('div');wc.className='g-day'
      wc.style.cssText=`width:${colW}px;overflow:hidden;white-space:nowrap`
      if(colW>=40)wc.textContent=wCur.toLocaleString('en',{month:'short'})+' '+wCur.getDate()
      dr.appendChild(wc);wOff+=7;wCur.setDate(wCur.getDate()+7)
    }

  } else {
    let cur=new Date(min),cy='',cypx=0,cmo='',cmoLbl='',cmopx=0
    for(let i=0;i<totalDays;i++){
      const yLabel=cur.getFullYear().toString()
      if(yLabel!==cy){
        if(cy){const el=document.createElement('div');el.className='g-month';el.style.width=cypx+'px';el.textContent=cy;mr.appendChild(el)}
        cy=yLabel;cypx=0
      }
      cypx+=DP
      const moKey=cur.getFullYear()+'-'+cur.getMonth()
      const moLbl=cur.toLocaleString('en',{month:'short'})
      if(moKey!==cmo){
        if(cmo){const el=document.createElement('div');el.className='g-day';el.style.cssText=`width:${cmopx}px;overflow:hidden;white-space:nowrap`;if(cmopx>=20)el.textContent=cmoLbl;dr.appendChild(el)}
        cmo=moKey;cmoLbl=moLbl;cmopx=0
      }
      cmopx+=DP;cur.setDate(cur.getDate()+1)
    }
    if(cy){const el=document.createElement('div');el.className='g-month';el.style.width=cypx+'px';el.textContent=cy;mr.appendChild(el)}
    if(cmo){const el=document.createElement('div');el.className='g-day';el.style.cssText=`width:${cmopx}px;overflow:hidden;white-space:nowrap`;if(cmopx>=20)el.textContent=cmoLbl;dr.appendChild(el)}
  }

  gh.appendChild(mr);gh.appendChild(dr)

  const gb=document.getElementById('gantt-body');gb.innerHTML='';gb.style.cssText=`width:${W}px;position:relative`
  const rowCont=document.createElement('div');rowCont.style.position='relative'
  const bfrag=document.createDocumentFragment()

  if(state.zoomLevel==='day'){
    const wd2=state.settings.weekendDays||[0,6]
    const d2=new Date(min)
    for(let i=0;i<totalDays;i++){
      const isWknd2=wd2.includes(d2.getDay())
      const isHol2=!isWknd2&&(state.settings.holidays||[]).some(h=>h.date===fmtISO(d2))
      if(isWknd2){const bg=document.createElement('div');bg.className='g-wknd';bg.style.cssText=`left:${i*DP}px;width:${DP}px`;bfrag.appendChild(bg)}
      else if(isHol2){const bg=document.createElement('div');bg.className='g-hol';bg.style.cssText=`left:${i*DP}px;width:${DP}px`;bfrag.appendChild(bg)}
      d2.setDate(d2.getDate()+1)
    }
  }
  const tx=dBetween(min,today)*DP
  if(tx>=0&&tx<=W){
    const tv=document.createElement('div');tv.className='today-vline';tv.style.left=tx+'px';bfrag.appendChild(tv)
    const tl=document.createElement('div');tl.className='today-vlbl';tl.style.left=tx+'px';tl.textContent='Today';bfrag.appendChild(tl)
  }

  visible.forEach(({task:t},rowIdx)=>{
    const row=document.createElement('div');row.className='g-row';row.dataset.taskId=t.id;row.style.width=W+'px'
    const hasKids=childMap?childMap.has(t.id):state.tasks.some(c=>c.parent_id===t.id)
    const{s,e}=hasKids?(getParentDates(t.id)||{s:pd(t.start_date),e:taskEnd(t)}):{s:pd(t.start_date),e:taskEnd(t)}
    const x=dBetween(min,s)*DP,w=Math.max((dBetween(s,e)+1)*DP,DP)
    const pct=hasKids?rollupPct(t.id):t.progress_pct
    const isCan=t.status==='Cancelled',bt=bMap.get(t.id)
    const isLate=!!(bt&&taskEnd(t)>taskEnd(bt))
    const tn=t.name||'',mid=RH/2,rowTop=rowIdx*RH

    if(t.type==='milestone'){
      if(bt?.type==='milestone'){const bms=document.createElement('div');bms.className='gms';const bsz=BMS,bbt2=mid-bsz/2,bx=dBetween(min,pd(bt.start_date))*DP;bms.style.cssText=`left:${bx-bsz/2}px;top:${rowTop+bbt2}px;width:${bsz}px;height:${bsz}px;background:rgba(100,116,139,.38);opacity:.65;pointer-events:none`;row.appendChild(bms)}
      const ms=document.createElement('div');ms.className='gms';const sz=BMS,bbt2=mid-sz/2;ms.style.cssText=`left:${x-sz/2}px;top:${rowTop+bbt2}px;width:${sz}px;height:${sz}px;background:var(--nt-grad);box-shadow:var(--nt-glow)`;ms.title=tn;ms.onclick=()=>openEditModal(t.id);ms.id='bar-'+t.id
      const lbl=document.createElement('div');lbl.className='gb-txt';lbl.style.cssText=`position:absolute;font-size:9px;color:var(--txt2);left:${x+sz+3}px;top:${rowTop+bbt2}px;white-space:nowrap;font-family:var(--mono)`;lbl.textContent=tn
      row.appendChild(ms);row.appendChild(lbl)
    } else {
      const bh=hasKids?BPH:BCH,bbt2=(RH-bh)/2
      if(bt&&bt.type!=='milestone'){const bs=pd(bt.start_date),be=taskEnd(bt);const bx=dBetween(min,bs)*DP,bw=Math.max((dBetween(bs,be)+1)*DP,DP);const ghost=document.createElement('div');ghost.className='gbar-ghost';ghost.style.cssText=`left:${bx}px;width:${bw}px;height:${bh}px;top:${rowTop+bbt2}px`;row.appendChild(ghost)}
      const bar=document.createElement('div');bar.id='bar-'+t.id
      if(hasKids){bar.className='gbar gb-parent';bar.style.cssText=`position:absolute;left:${x}px;width:${w}px;height:${bh}px;top:${rowTop+bbt2}px`}
      else{bar.className=`gbar ${isCan?'gb-cancel':'gb-custom'}`;bar.style.cssText=`left:${x}px;width:${w}px;height:${bh}px;top:${rowTop+bbt2}px`;if(!isCan&&!hasKids){const cColor=getCatColor(t.category);bar.style.backgroundColor=cColor;bar.style.boxShadow=`0 2px 8px ${cColor}40`}}
      if(t.locked)bar.classList.add('locked-bar')
      if(isLate)bar.classList.add('baseline-late')
      if(!isCan&&pct>0&&!hasKids){const fill=document.createElement('div');fill.className='gbar-fill';fill.style.width=pct+'%';bar.appendChild(fill)}
      if(w>40&&DP>=12&&!hasKids){const lbl=document.createElement('div');lbl.className='gbar-lbl gb-txt';lbl.textContent=tn;bar.appendChild(lbl)}
      if(pct>0){const pl=document.createElement('div');pl.className='gbar-pct';pl.style.cssText=`left:${x+w+3}px;top:${rowTop+bbt2}px`;pl.textContent=pct+'%';row.appendChild(pl)}
      bar.dataset.taskId=t.id
      bar.addEventListener('mouseenter',e=>_showTaskTooltip(e,t.id))
      bar.addEventListener('mousemove',_posCalTooltip)
      bar.addEventListener('mouseleave',_hideCalTooltip)
      bar.onclick=()=>{if(barWasDragged){barWasDragged=false;return}openEditModal(t.id)}
      row.appendChild(bar)
    }
    rowCont.appendChild(row)
  })

  gb.appendChild(bfrag);gb.appendChild(rowCont)
  document.getElementById('gantt-wrap').style.cssText=`width:${W}px;min-width:${W}px`

  requestAnimationFrame(()=>renderLinks())
}

function renderLinks(){
  const svgCanvas=document.getElementById('links-svg')
  if(!svgCanvas)return
  svgCanvas.innerHTML=''
  if(!state.deps.length)return
  const svgRect=svgCanvas.getBoundingClientRect()
  if(!svgRect.width)return
  const DC={FS:'#3B00FF',SS:'#00b87a',FF:'#d97706',SF:'#e11d48'}
  state.deps.forEach(dep=>{
    const fEl=document.getElementById('bar-'+dep.from_task_id)
    const tEl=document.getElementById('bar-'+dep.to_task_id)
    if(!fEl||!tEl)return
    const fromRect=fEl.getBoundingClientRect()
    const toRect=tEl.getBoundingClientRect()
    if(!fromRect.width||!toRect.width)return
    const fMs=fEl.classList.contains('gms'),tMs=tEl.classList.contains('gms')
    const color=DC[dep.dep_type]||'#3B00FF'
    let x1,x2
    if(dep.dep_type==='FS'){
      x1=fMs?(fromRect.left+fromRect.right)/2-svgRect.left:fromRect.right-svgRect.left
      x2=tMs?(toRect.left+toRect.right)/2-svgRect.left:toRect.left-svgRect.left
    } else if(dep.dep_type==='SS'){
      x1=fMs?(fromRect.left+fromRect.right)/2-svgRect.left:fromRect.left-svgRect.left
      x2=tMs?(toRect.left+toRect.right)/2-svgRect.left:toRect.left-svgRect.left
    } else if(dep.dep_type==='FF'){
      x1=fMs?(fromRect.left+fromRect.right)/2-svgRect.left:fromRect.right-svgRect.left
      x2=tMs?(toRect.left+toRect.right)/2-svgRect.left:toRect.right-svgRect.left
    } else {
      x1=fMs?(fromRect.left+fromRect.right)/2-svgRect.left:fromRect.left-svgRect.left
      x2=tMs?(toRect.left+toRect.right)/2-svgRect.left:toRect.right-svgRect.left
    }
    const y1=fromRect.top-svgRect.top+fromRect.height/2
    const y2=toRect.top-svgRect.top+toRect.height/2
    const cx=(x1+x2)/2
    const path=document.createElementNS('http://www.w3.org/2000/svg','path')
    path.setAttribute('d',`M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`)
    path.setAttribute('fill','none');path.setAttribute('stroke',color);path.setAttribute('stroke-width','1.5');path.setAttribute('stroke-dasharray','4,3');path.setAttribute('opacity','.6')
    const arrow=document.createElementNS('http://www.w3.org/2000/svg','polygon')
    if(dep.dep_type==='FS'||dep.dep_type==='SS')arrow.setAttribute('points',`${x2},${y2} ${x2-6},${y2-3} ${x2-6},${y2+3}`)
    else arrow.setAttribute('points',`${x2},${y2} ${x2+6},${y2-3} ${x2+6},${y2+3}`)
    arrow.setAttribute('fill',color);arrow.setAttribute('opacity','.6')
    const lx=(x1+x2)/2,ly=(y1+y2)/2-5
    const bg=document.createElementNS('http://www.w3.org/2000/svg','rect');bg.setAttribute('x',lx-7);bg.setAttribute('y',ly-7);bg.setAttribute('width','14');bg.setAttribute('height','10');bg.setAttribute('rx','2');bg.setAttribute('fill','white');bg.setAttribute('opacity','.9')
    const lbl=document.createElementNS('http://www.w3.org/2000/svg','text');lbl.setAttribute('x',lx);lbl.setAttribute('y',ly);lbl.setAttribute('text-anchor','middle');lbl.setAttribute('font-size','8');lbl.setAttribute('fill',color);lbl.setAttribute('font-family','DM Mono');lbl.setAttribute('font-weight','600');lbl.textContent=dep.dep_type
    svgCanvas.appendChild(path);svgCanvas.appendChild(arrow);svgCanvas.appendChild(bg);svgCanvas.appendChild(lbl)
  })
}

function renderSB(){
  const total=state.tasks.length,done=state.tasks.filter(t=>t.status==='Completed').length
  const today=new Date()
  const validTasks=state.tasks.filter(t=>t.start_date)
  const delayed=validTasks.filter(t=>{const e=taskEnd(t);return e<today&&t.status!=='Completed'&&t.status!=='Cancelled'})
  const activeTasks=state.tasks.filter(t=>t.status!=='Cancelled')
  const avgPct=total?Math.round(activeTasks.reduce((s,t)=>s+t.progress_pct,0)/Math.max(1,activeTasks.length)):0
  document.getElementById('sb-tasks').textContent=`${total} tasks · ${done} done`
  document.getElementById('sb-prog').textContent=`${avgPct}% overall`
  document.getElementById('sb-badge').innerHTML=delayed.length?`<span class="sb-badge sb-warn">${delayed.length} overdue</span>`:(total?`<span class="sb-badge sb-ok">On Track</span>`:'')
  if(!validTasks.length)return
  const dates=validTasks.map(t=>pd(t.start_date))
  const minD=new Date(Math.min(...dates))
  document.getElementById('sb-range').textContent=`${fmtS(minD)} – ${fmtS(taskEnd(validTasks.reduce((a,b)=>taskEnd(b)>taskEnd(a)?b:a,validTasks[0])))}`
}
// === VIEW SWITCHING ===
const VIEW_DISPLAY={gantt:'flex',kanban:'block',calendar:'block',dashboard:'flex'}
function switchView(name){
  state.currentView=name
  Object.keys(VIEW_DISPLAY).forEach(v=>{
    document.getElementById('view-'+v).style.display=v===name?VIEW_DISPLAY[v]:'none'
  })
  document.querySelectorAll('.view-tab').forEach(btn=>{
    btn.classList.toggle('active',btn.dataset.view===name)
  })
  render()
}

// === KANBAN ===
function renderKanban(){
  renderCache=buildRenderCache()
  const cm=renderCache.childMap,tb=renderCache.taskById
  const container=document.getElementById('view-kanban')
  if(!container)return
  const COLS=[
    {id:'Not Started',color:'#94a3b8'},
    {id:'In Progress',color:'#3B00FF'},
    {id:'Completed',color:'#059669'},
    {id:'Delayed',color:'#ef4444'},
    {id:'On Hold',color:'#d97706'},
  ]
  const grouped={}
  COLS.forEach(c=>{grouped[c.id]=[]})
  state.tasks.forEach(t=>{
    const st=getDerivedStatus(t,rollupPct(t.id))
    if(st==='Cancelled')return
    if(grouped[st])grouped[st].push(t)
  })
  const board=document.createElement('div')
  board.className='kb-board'
  COLS.forEach(col=>{
    const tasks=grouped[col.id]||[]
    const colEl=document.createElement('div')
    colEl.className='kb-col'
    colEl.dataset.status=col.id
    const hdr=document.createElement('div')
    hdr.className='kb-col-hdr'
    hdr.style.borderTop=`3px solid ${col.color}`
    hdr.innerHTML=`<span class="kb-col-title">${col.id}</span><span class="kb-col-count">${tasks.length}</span>`
    const body=document.createElement('div')
    body.className='kb-col-body'
    if(!tasks.length){
      const empty=document.createElement('div')
      empty.className='kb-empty'
      empty.textContent='No tasks'
      body.appendChild(empty)
    }
    tasks.forEach(t=>{
      const hasKids=cm.has(t.id)
      const pct=rollupPct(t.id)
      const isSubtask=!!t.parent_id
      const parentTask=isSubtask?tb.get(t.parent_id)||null:null
      const catColor=getCatColor(t.category)
      const card=document.createElement('div')
      card.className=`kb-card ${isSubtask?'kb-card-sub':'kb-card-main'}`
      card.draggable=true
      card.dataset.taskId=t.id
      card.innerHTML=`
        <div class="kb-card-accent" style="background:${catColor}"></div>
        ${isSubtask&&parentTask?`<div class="kb-parent-ref">↳ ${esc(parentTask.name)}</div>`:''}
        <div class="kb-card-name">${esc(t.name)}</div>
        <div class="kb-card-meta">
          <span class="kb-card-tag" style="background:${catColor}1a;color:${catColor};border:1px solid ${catColor}40">${esc(t.category)}</span>
          ${!isSubtask&&hasKids?'<span class="kb-main-badge">Main</span>':''}
          ${t.type==='milestone'?'<span class="kb-card-tag" style="background:#fef3c7;color:#d97706;border:1px solid #fde68a">◆ MS</span>':''}
        </div>
        ${t.assignee?`<div class="kb-card-info">👤 ${esc(t.assignee)}</div>`:''}
        <div class="kb-card-info">${fmtS(pd(t.start_date))} → ${fmtS(taskEnd(t))}</div>
        <div class="kb-pbar-wrap"><div class="kb-pbar" style="width:${pct}%"></div></div>
        <div class="kb-pct">${pct}%</div>`
      card.ondragstart=e=>{
        e.dataTransfer.setData('text/plain',t.id)
        card.classList.add('dragging')
      }
      card.ondragend=()=>card.classList.remove('dragging')
      card.ondblclick=()=>openTaskModal(t.id)
      card.addEventListener('mouseenter',e=>_showTaskTooltip(e,t.id))
      card.addEventListener('mousemove',_posCalTooltip)
      card.addEventListener('mouseleave',_hideCalTooltip)
      body.appendChild(card)
    })
    colEl.ondragover=e=>{e.preventDefault();colEl.classList.add('drag-over-col')}
    colEl.ondragleave=e=>{if(!colEl.contains(e.relatedTarget))colEl.classList.remove('drag-over-col')}
    colEl.ondrop=async e=>{
      e.preventDefault();colEl.classList.remove('drag-over-col')
      const taskId=e.dataTransfer.getData('text/plain')
      if(!taskId)return
      const task=state.tasks.find(x=>x.id===taskId)
      if(!task)return
      const newStatus=col.id
      const updates={status:newStatus}
      if(newStatus==='Not Started')updates.progress_pct=0
      if(newStatus==='Completed')updates.progress_pct=100
      const oldStatus=task.status,oldPct=task.progress_pct
      task.status=newStatus
      if(updates.progress_pct!==undefined)task.progress_pct=updates.progress_pct
      renderKanban();renderSB()
      setSS('⟳ Saving...')
      const{error}=await db.from('tasks').update(updates).eq('id',taskId)
      if(error){
        task.status=oldStatus;task.progress_pct=oldPct
        renderKanban();renderSB()
        toast('❌ Failed: '+error.message);setSS('✗ Error')
      }else{setSS('✓ Synced');toast(`✅ Moved to ${newStatus}`)}
    }
    colEl.appendChild(hdr);colEl.appendChild(body);board.appendChild(colEl)
  })
  container.innerHTML=''
  container.appendChild(board)
}

// === CALENDAR ===
function renderCalendar(){
  const container=document.getElementById('view-calendar')
  if(!container)return
  const year=state.calendarYear,month=state.calendarMonth
  const today=new Date()
  const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December']
  const DOWS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
  const wkndDays=state.settings.weekendDays||[0,6]
  const firstDay=new Date(year,month,1)
  const daysInMonth=new Date(year,month+1,0).getDate()
  const startDow=firstDay.getDay()
  const tasksByDay={}
  state.tasks.forEach(t=>{
    if(!t.start_date)return
    const s=pd(t.start_date),e=taskEnd(t)
    const mS=new Date(year,month,1),mE=new Date(year,month+1,0)
    if(e<mS||s>mE)return
    for(let d=1;d<=daysInMonth;d++){
      const date=new Date(year,month,d)
      if(date>=s&&date<=e){
        if(!tasksByDay[d])tasksByDay[d]=[]
        tasksByDay[d].push(t)
      }
    }
  })
  let html=`<div class="cal-wrap">
    <div class="cal-nav">
      <button class="cal-nav-btn" onclick="calNav(-1)">&#8249;</button>
      <span class="cal-month-label">${MONTHS[month]} ${year}</span>
      <button class="cal-nav-btn" onclick="calNav(1)">&#8250;</button>
      <button class="tb today" style="margin-left:8px;font-size:11px;padding:0 10px;height:26px" onclick="calNavToday()">Today</button>
    </div>
    <div class="cal-grid">`
  DOWS.forEach((d,i)=>{html+=`<div class="cal-dow${wkndDays.includes(i)?' wknd':''}">${d}</div>`})
  const prevMonthDays=new Date(year,month,0).getDate()
  for(let i=0;i<startDow;i++){
    html+=`<div class="cal-day other-month"><div class="cal-day-num">${prevMonthDays-startDow+i+1}</div></div>`
  }
  for(let d=1;d<=daysInMonth;d++){
    const date=new Date(year,month,d)
    const dow=date.getDay()
    const isToday=date.toDateString()===today.toDateString()
    const isWknd=wkndDays.includes(dow)
    const tasks=tasksByDay[d]||[]
    const MAX=3
    let cls='cal-day'+(isWknd?' is-wknd':'')+(isToday?' is-today':'')
    const dayNum=isToday
      ?`<span style="background:var(--nt-grad);color:#fff;border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center;font-size:10px">${d}</span>`
      :d
    let bars=''
    tasks.slice(0,MAX).forEach(t=>{
      const c=getCatColor(t.category)
      bars+=`<div class="cal-task-bar" data-task-id="${esc(t.id)}" style="background:${c}" title="${esc(t.name)}">${esc(t.name)}</div>`
    })
    if(tasks.length>MAX)bars+=`<div class="cal-more" data-task-ids="${tasks.map(t=>t.id).join(',')}" onclick="event.stopPropagation();showCalMorePopup(this)">+${tasks.length-MAX} more</div>`
    html+=`<div class="${cls}"><div class="cal-day-num">${dayNum}</div>${bars}</div>`
  }
  const totalCells=startDow+daysInMonth
  const rem=totalCells%7===0?0:7-totalCells%7
  for(let i=1;i<=rem;i++){html+=`<div class="cal-day other-month"><div class="cal-day-num">${i}</div></div>`}
  html+='</div></div>'
  container.innerHTML=html
  container.querySelectorAll('.cal-task-bar').forEach(el=>{
    el.addEventListener('click',()=>openDetailPanel(el.dataset.taskId))
    el.addEventListener('mouseover',e=>_showCalTooltip(e,state.tasks.find(t=>t.id===el.dataset.taskId)))
    el.addEventListener('mousemove',_posCalTooltip)
    el.addEventListener('mouseout',_hideCalTooltip)
  })
}
function _showCalTooltip(e,t){
  if(!t)return
  const tip=document.getElementById('cal-tooltip');if(!tip)return
  const pct=t.progress_pct||0
  const ds=getDerivedStatus(t,pct),sc=STATUS_CLASS[ds]||'s-none'
  const ov=(state.settings.statusOverrides||{})[ds]
  const bs=(ov&&ov.override&&ov.color)?`background:${ov.color}22;color:${ov.color};border:1px solid ${ov.color}44`:''
  tip.innerHTML=`<div style="font-weight:700;color:var(--txt);margin-bottom:6px;line-height:1.3;font-size:12px">${esc(t.name)}</div>
    <span class="sbadge ${sc}" style="${bs};font-size:10px">${esc(STATUS_LABELS[ds]||ds)}</span>
    <div style="color:var(--txt3);font-size:10px;margin-top:5px;font-family:var(--mono)">${fmtS(pd(t.start_date))} → ${fmtS(taskEnd(t))}</div>
    <div style="margin-top:6px">
      <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--txt3);margin-bottom:3px"><span>Progress</span><span>${pct}%</span></div>
      <div style="height:4px;background:#E5E7EB;border-radius:4px"><div style="height:100%;width:${pct}%;background:var(--nt-grad90);border-radius:4px"></div></div>
    </div>`
  tip.classList.remove('hidden')
  _posCalTooltip(e)
}
function _posCalTooltip(e){
  const tip=document.getElementById('cal-tooltip');if(!tip||tip.classList.contains('hidden'))return
  const x=e.clientX+14,y=e.clientY+14
  const tw=tip.offsetWidth||220,th=tip.offsetHeight||90
  tip.style.left=(x+tw>window.innerWidth-10?e.clientX-tw-10:x)+'px'
  tip.style.top=(y+th>window.innerHeight-10?e.clientY-th-10:y)+'px'
}
function _hideCalTooltip(){document.getElementById('cal-tooltip')?.classList.add('hidden')}
function _showTaskTooltip(e,taskId){
  const t=state.tasks.find(x=>x.id===taskId);if(!t)return
  const tip=document.getElementById('cal-tooltip');if(!tip)return
  const pct=rollupPct(taskId)
  const ds=getDerivedStatus(t,pct),sc=STATUS_CLASS[ds]||'s-none'
  const ov=(state.settings.statusOverrides||{})[ds]
  const bs=(ov&&ov.override&&ov.color)?`background:${ov.color}22;color:${ov.color};border:1px solid ${ov.color}44`:''
  const logs=state.taskLogs[taskId]||[]
  const latestNote=logs.length
    ?`<div class="tl-tip-note">${esc(logs[0].note)}<span class="tl-tip-date">${fmtS(new Date(logs[0].logged_at))}</span></div>`
    :`<div class="tl-tip-empty">ยังไม่มีบันทึกความคืบหน้า</div>`
  tip.innerHTML=`<div style="font-weight:700;color:var(--txt);margin-bottom:6px;line-height:1.3;font-size:12px">${esc(t.name)}</div>
    <span class="sbadge ${sc}" style="${bs};font-size:10px">${esc(STATUS_LABELS[ds]||ds)}</span>
    <div style="color:var(--txt3);font-size:10px;margin-top:5px;font-family:var(--mono)">${fmtS(pd(t.start_date))} → ${fmtS(taskEnd(t))}</div>
    <div style="margin-top:6px">
      <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--txt3);margin-bottom:3px"><span>Progress</span><span>${pct}%</span></div>
      <div style="height:4px;background:#E5E7EB;border-radius:4px"><div style="height:100%;width:${pct}%;background:var(--nt-grad90);border-radius:4px"></div></div>
    </div>
    <div class="tl-tip-divider"></div>
    ${latestNote}`
  tip.classList.remove('hidden')
  _posCalTooltip(e)
}
function showCalMorePopup(el){
  _hideCalTooltip()
  const popup=document.getElementById('cal-day-popup');if(!popup)return
  const ids=(el.dataset.taskIds||'').split(',').filter(Boolean)
  const tasks=ids.map(id=>state.tasks.find(t=>t.id===id)).filter(Boolean)
  if(!tasks.length)return
  popup.innerHTML=`<div class="cdp-header"><span>${tasks.length} tasks this day</span><button type="button" class="cdp-close" onclick="document.getElementById('cal-day-popup').classList.add('hidden')">✕</button></div>
    <div class="cdp-list">${tasks.map(t=>{
      const pct=t.progress_pct||0,ds=getDerivedStatus(t,pct),sc=STATUS_CLASS[ds]||'s-none'
      const ov=(state.settings.statusOverrides||{})[ds]
      const bs=(ov&&ov.override&&ov.color)?`background:${ov.color}22;color:${ov.color};border:1px solid ${ov.color}44`:''
      return`<div class="cdp-item" style="border-left:3px solid ${getCatColor(t.category)}" onclick="openDetailPanel('${t.id}');document.getElementById('cal-day-popup').classList.add('hidden')">
        <div class="cdp-name">${esc(t.name)}</div>
        <span class="sbadge ${sc}" style="${bs};font-size:9px;padding:1px 5px">${esc(STATUS_LABELS[ds]||ds)}</span>
      </div>`}).join('')}</div>`
  popup.classList.remove('hidden')
  popup.setAttribute('aria-hidden','false')
  const rect=el.getBoundingClientRect()
  const pw=220,ph=popup.offsetHeight||200
  popup.style.left=Math.min(rect.left,window.innerWidth-pw-10)+'px'
  popup.style.top=(rect.bottom+4+ph>window.innerHeight-10?rect.top-ph-4:rect.bottom+4)+'px'
}
document.addEventListener('click',e=>{
  if(!e.target.closest('#cal-day-popup')&&!e.target.closest('.cal-more'))
    document.getElementById('cal-day-popup')?.classList.add('hidden')
})
function calNav(dir){
  state.calendarMonth+=dir
  if(state.calendarMonth>11){state.calendarMonth=0;state.calendarYear++}
  if(state.calendarMonth<0){state.calendarMonth=11;state.calendarYear--}
  renderCalendar()
}
function calNavToday(){
  const n=new Date();state.calendarYear=n.getFullYear();state.calendarMonth=n.getMonth();renderCalendar()
}

// === DASHBOARD ===
let _chartStatus=null,_chartCategory=null,_chartAssignee=null

function renderDashboard(){
  const container=document.getElementById('view-dashboard')
  if(!container)return

  // ── KPI calculations ──────────────────────────────────────────
  const tasks=state.tasks
  const cm=renderCache?.childMap
  const today=new Date()
  const total=tasks.length
  const cancelled=tasks.filter(t=>t.status==='Cancelled').length
  const activeTasks=tasks.filter(t=>t.status!=='Cancelled')
  const completed=tasks.filter(t=>getDerivedStatus(t,rollupPct(t.id))==='Completed').length
  const inProgress=tasks.filter(t=>getDerivedStatus(t,rollupPct(t.id))==='In Progress').length
  const delayed=tasks.filter(t=>{
    if(t.status==='Cancelled'||t.status==='Completed')return false
    return taskEnd(t)<today||t.status==='Delayed'
  }).length
  const onHold=tasks.filter(t=>t.status==='On Hold').length
  const avgPct=activeTasks.length?Math.round(activeTasks.reduce((s,t)=>s+t.progress_pct,0)/activeTasks.length):0
  const completionPct=total?Math.round(completed/total*100):0
  const pctColor=avgPct>=75?'#059669':avgPct>=40?'#d97706':'#ef4444'

  // ── Status counts ─────────────────────────────────────────────
  const statusCounts={'Not Started':0,'In Progress':0,'Completed':0,'Delayed':0,'On Hold':0,'Cancelled':0}
  tasks.forEach(t=>{
    const st=getDerivedStatus(t,rollupPct(t.id))
    if(statusCounts[st]!==undefined)statusCounts[st]++
  })
  const statusColors={'Not Started':'#94a3b8','In Progress':'#3B00FF','Completed':'#059669','Delayed':'#ef4444','On Hold':'#d97706','Cancelled':'#cbd5e1'}

  // ── Category counts ───────────────────────────────────────────
  const catCounts={}
  tasks.forEach(t=>{const c=t.category||'General';catCounts[c]=(catCounts[c]||0)+1})
  const catKeys=Object.keys(catCounts)

  // ── Assignee counts (top 8) ───────────────────────────────────
  const assigneeCounts={}
  tasks.forEach(t=>{const a=(t.assignee||'').trim()||'Unassigned';assigneeCounts[a]=(assigneeCounts[a]||0)+1})
  const assigneeEntries=Object.entries(assigneeCounts).sort((a,b)=>b[1]-a[1]).slice(0,8)
  const assigneeKeys=assigneeEntries.map(e=>e[0])
  const assigneeData=assigneeEntries.map(e=>e[1])

  // ── Top tasks by progress ─────────────────────────────────────
  const topTasks=[...tasks]
    .filter(t=>!(cm?cm.has(t.id):state.tasks.some(c=>c.parent_id===t.id))&&t.status!=='Cancelled')
    .sort((a,b)=>b.progress_pct-a.progress_pct)
    .slice(0,10)

  // ── SVG icon strings ──────────────────────────────────────────
  const IC={
    list:`<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 16 16"><path d="M2 4h12M2 8h9M2 12h6"/></svg>`,
    check:`<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/><path d="M5.5 8.5l2 2 3-3.5"/></svg>`,
    clock:`<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/><path d="M8 5v3l2 1.5"/></svg>`,
    alert:`<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 16 16"><path d="M8 2.5L14 13H2L8 2.5z"/><path d="M8 7v2.5"/><circle cx="8" cy="11.8" r=".6" fill="currentColor" stroke="none"/></svg>`,
    pause:`<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" viewBox="0 0 16 16"><line x1="5" y1="3" x2="5" y2="13"/><line x1="11" y1="3" x2="11" y2="13"/></svg>`,
    trend:`<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 16 16"><polyline points="2,12 6,7 9.5,10 14,4"/><polyline points="11,4 14,4 14,7"/></svg>`
  }

  // ── Card builder ──────────────────────────────────────────────
  const card=(label,value,suffix,color,trendHtml,icon)=>`
    <div class="dash-card" style="border-left-color:${color}">
      <div class="dash-card-hdr">
        <div class="dash-card-label">${label}</div>
        <div class="dash-card-icon-wrap" style="background:${color}18;color:${color}">${icon}</div>
      </div>
      <div class="dash-card-value" style="color:${color}">${value}${suffix?`<span style="font-size:1rem;font-weight:500;margin-left:2px;opacity:.65">${suffix}</span>`:''}</div>
      <div class="dash-card-trend">${trendHtml}</div>
    </div>`

  const now=new Date().toLocaleDateString('en',{month:'short',day:'numeric',year:'numeric'})

  // ── Progression log data (grouped by task) ───────────────────
  const taskMap=Object.fromEntries(state.tasks.map(t=>[t.id,t]))
  const grouped={}
  Object.entries(state.taskLogs).forEach(([tid,logs])=>{
    if(logs.length)grouped[tid]=[...logs].sort((a,b)=>new Date(b.logged_at)-new Date(a.logged_at))
  })
  const groupEntries=Object.entries(grouped).sort((a,b)=>new Date(b[1][0].logged_at)-new Date(a[1][0].logged_at))
  const totalLogs=groupEntries.reduce((s,[,l])=>s+l.length,0)
  const pctC=p=>p===100?'#059669':p>=60?'#3B00FF':p>0?'#d97706':'#94a3b8'
  const logCardsHtml=groupEntries.map(([tid,logs])=>{
    const task=taskMap[tid]
    if(!task)return''
    const st=getDerivedStatus(task,rollupPct(task.id))
    const dotColor=statusColors[st]||'#94a3b8'
    const curPct=task.progress_pct
    const curPctColor=pctC(curPct)
    const barColor=curPct===100?'#059669':curPct>=60?'#3B00FF':curPct>0?'#d97706':'#e2e8f0'
    const entries=logs.map((log,i)=>{
      const pct=log.progress_pct
      const dt=new Date(log.logged_at)
      const dateStr=dt.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})
      const timeStr=dt.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})
      return`<div class="dlc-entry${i<logs.length-1?' dlc-entry--border':''}">
        <div class="dlc-entry-top">
          <span class="dlc-entry-dt"><span class="dlc-entry-date">${dateStr}</span><span class="dlc-entry-time">${timeStr}</span></span>
          <span class="dash-log-pct-badge" style="background:${pctC(pct)}18;color:${pctC(pct)}">${pct}%</span>
          ${log.logged_by?`<span class="dlc-entry-by">${esc(log.logged_by)}</span>`:''}
        </div>
        ${log.note?`<div class="dlc-entry-note">${esc(log.note)}</div>`:''}
      </div>`
    }).join('')
    return`<div class="dlc">
      <div class="dlc-hdr">
        <div class="dlc-title">
          <span class="dash-tl-dot" style="background:${dotColor};width:8px;height:8px;flex-shrink:0"></span>
          <span class="dlc-name" title="${esc(task.name)}">${esc(task.name)}</span>
        </div>
        <div class="dlc-meta">
          <span class="dash-log-pct-badge" style="background:${curPctColor}18;color:${curPctColor}">${curPct}%</span>
          <span class="dlc-count">${logs.length} log${logs.length!==1?'s':''}</span>
        </div>
      </div>
      <div class="dlc-bar-wrap"><div class="dlc-bar" style="width:${curPct}%;background:${barColor}"></div></div>
      <div class="dlc-body">${entries}</div>
    </div>`
  }).join('')

  // ── Build HTML ────────────────────────────────────────────────
  container.innerHTML=`
  <div class="dash-wrap">

    <div>
      <div class="dash-section-hdr">
        <span class="dash-section-title">Key Performance Indicators</span>
        <span class="dash-section-meta">As of ${now} &nbsp;·&nbsp; ${total} total tasks</span>
      </div>
      <div class="dash-cards">
        ${card('Total Tasks',total,'','#6366f1',
          `${activeTasks.length} active &nbsp;·&nbsp; ${cancelled} cancelled`,IC.list)}
        ${card('Completed',completed,'','#059669',
          `<span style="color:#059669;font-weight:700">&#x2191; ${completionPct}%</span> of total project`,IC.check)}
        ${card('In Progress',inProgress,'','#3B00FF',
          `${inProgress} of ${activeTasks.length} active tasks`,IC.clock)}
        ${card('Delayed / Overdue',delayed,'','#ef4444',
          delayed>0?`<span style="color:#ef4444;font-weight:700">&#9888; Needs attention</span>`:`<span style="color:#059669">&#10003; All on track</span>`,IC.alert)}
        ${card('On Hold',onHold,'','#d97706',
          onHold?`${onHold} task${onHold!==1?'s':''} paused`:`None paused`,IC.pause)}
        ${card('Overall Progress',avgPct,'%',pctColor,
          `<span style="color:${pctColor};font-weight:700">${avgPct>=75?'&#10003; On track':avgPct>=40?'&#9651; Needs focus':'&#9888; Behind schedule'}</span>`,IC.trend)}
      </div>
    </div>

    <div>
      <div class="dash-section-hdr">
        <span class="dash-section-title">Status &amp; Category Overview</span>
      </div>
      <div class="dash-charts">
        <div class="dash-chart-box">
          <div class="dash-chart-hdr">
            <span class="dash-chart-title">Task Status Breakdown</span>
            <span class="dash-chart-badge">${total} tasks</span>
          </div>
          <div class="dash-chart-canvas"><canvas id="canvas-status"></canvas></div>
        </div>
        <div class="dash-chart-box">
          <div class="dash-chart-hdr">
            <span class="dash-chart-title">Tasks by Category</span>
            <span class="dash-chart-badge">${catKeys.length} categories</span>
          </div>
          <div class="dash-chart-canvas"><canvas id="canvas-category"></canvas></div>
        </div>
      </div>
    </div>

    <div>
      <div class="dash-section-hdr">
        <span class="dash-section-title">Workload &amp; Progress Detail</span>
      </div>
      <div class="dash-bottom">
        <div class="dash-panel">
          <div class="dash-chart-hdr">
            <span class="dash-chart-title">Top Tasks by Progress</span>
            <span class="dash-chart-badge">${topTasks.length} shown</span>
          </div>
          ${topTasks.map(t=>{
            const pct=t.progress_pct
            const barColor=pct===100?'#059669':pct>60?'#3B00FF':pct>0?'#d97706':'#e2e8f0'
            const dotColor=statusColors[getDerivedStatus(t,pct)]||'#94a3b8'
            return `<div class="dash-tl-row">
              <div class="dash-tl-name"><div class="dash-tl-dot" style="background:${dotColor}"></div><span title="${esc(t.name)}">${esc(t.name)}</span></div>
              <div class="dash-tl-bar-wrap"><div class="dash-tl-bar" style="width:${pct}%;background:${barColor}"></div></div>
              <div class="dash-tl-pct">${pct}%</div>
            </div>`
          }).join('')}
          ${!topTasks.length?'<div style="text-align:center;padding:24px;font-size:12px;color:var(--txt3)">No tasks yet</div>':''}
        </div>
        <div class="dash-chart-box">
          <div class="dash-chart-hdr">
            <span class="dash-chart-title">Tasks by Assignee</span>
            <span class="dash-chart-badge">${assigneeKeys.length} assignees</span>
          </div>
          <div class="dash-chart-canvas" style="height:${Math.max(200,assigneeKeys.length*34)}px">
            <canvas id="canvas-assignee"></canvas>
          </div>
        </div>
      </div>
    </div>

    <div>
      <div class="dash-section-hdr">
        <span class="dash-section-title">Progression Log</span>
        <span class="dash-section-meta">${totalLogs} entries &nbsp;·&nbsp; ${groupEntries.length} tasks</span>
      </div>
      <div class="${totalLogs?'dash-log-grid':'dash-log-wrap'}">
        ${totalLogs?logCardsHtml:`<div class="dash-log-empty">No progress logs recorded yet.</div>`}
      </div>
    </div>

  </div>`

  // ── Destroy previous instances ────────────────────────────────
  if(_chartStatus){_chartStatus.destroy();_chartStatus=null}
  if(_chartCategory){_chartCategory.destroy();_chartCategory=null}
  if(_chartAssignee){_chartAssignee.destroy();_chartAssignee=null}
  if(!window.Chart)return

  const fontFamily=state.settings.fontFamily||"'Noto Sans Thai',sans-serif"
  Chart.defaults.font.family=fontFamily
  Chart.defaults.font.size=11
  Chart.defaults.color='#64748b'

  // Donut — status
  const statusLabels=Object.keys(statusCounts).filter(k=>statusCounts[k]>0)
  const statusData=statusLabels.map(k=>statusCounts[k])
  const statusColArr=statusLabels.map(k=>statusColors[k]||'#888')
  const ctxS=document.getElementById('canvas-status')
  if(ctxS&&statusData.some(v=>v>0)){
    _chartStatus=new Chart(ctxS,{
      type:'doughnut',
      data:{
        labels:statusLabels,
        datasets:[{data:statusData,backgroundColor:statusColArr,borderColor:'#fff',borderWidth:3,hoverOffset:8}]
      },
      options:{
        responsive:true,maintainAspectRatio:false,cutout:'65%',
        plugins:{
          legend:{
            position:'right',
            labels:{boxWidth:10,padding:14,font:{size:11},
              generateLabels(chart){
                const ds=chart.data.datasets[0]
                return chart.data.labels.map((l,i)=>({
                  text:`${l}  (${ds.data[i]})`,
                  fillStyle:ds.backgroundColor[i],
                  strokeStyle:'#fff',lineWidth:1,hidden:false,index:i
                }))
              }
            }
          },
          tooltip:{callbacks:{label:ctx=>`${ctx.label}: ${ctx.parsed} task${ctx.parsed!==1?'s':''}`}}
        }
      }
    })
  }

  // Bar — category
  const catColArr=catKeys.map(k=>getCatColor(k))
  const ctxC=document.getElementById('canvas-category')
  if(ctxC&&catKeys.length){
    _chartCategory=new Chart(ctxC,{
      type:'bar',
      data:{
        labels:catKeys,
        datasets:[{
          label:'Tasks',
          data:catKeys.map(k=>catCounts[k]),
          backgroundColor:catColArr.map(c=>c+'bb'),
          borderColor:catColArr,
          borderWidth:1.5,
          borderRadius:6,
          borderSkipped:false
        }]
      },
      options:{
        responsive:true,maintainAspectRatio:false,
        plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>`${ctx.parsed.y} task${ctx.parsed.y!==1?'s':''}`}}},
        scales:{
          x:{grid:{display:false},ticks:{font:{size:11}}},
          y:{beginAtZero:true,grid:{color:'rgba(0,0,0,.04)'},ticks:{stepSize:1,precision:0,font:{size:11}}}
        }
      }
    })
  }

  // Horizontal bar — assignee
  const ctxA=document.getElementById('canvas-assignee')
  if(ctxA&&assigneeKeys.length){
    const palette=['#6366f1','#059669','#d97706','#ef4444','#3B00FF','#8b5cf6','#0ea5e9','#00b87a']
    const aColors=assigneeKeys.map((_,i)=>palette[i%palette.length])
    _chartAssignee=new Chart(ctxA,{
      type:'bar',
      data:{
        labels:assigneeKeys,
        datasets:[{
          label:'Tasks',
          data:assigneeData,
          backgroundColor:aColors.map(c=>c+'bb'),
          borderColor:aColors,
          borderWidth:1.5,
          borderRadius:5,
          borderSkipped:false
        }]
      },
      options:{
        indexAxis:'y',
        responsive:true,maintainAspectRatio:false,
        plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>`${ctx.parsed.x} task${ctx.parsed.x!==1?'s':''}`}}},
        scales:{
          x:{beginAtZero:true,grid:{color:'rgba(0,0,0,.04)'},ticks:{stepSize:1,precision:0,font:{size:10}}},
          y:{grid:{display:false},ticks:{font:{size:11}}}
        }
      }
    })
  }
}

// === SCROLL SYNC ===
function initSS(){
  const tl=document.getElementById('task-list'),r=document.getElementById('right')
  tl.addEventListener('scroll',()=>{if(isSS)return;isSS=true;r.scrollTop=tl.scrollTop;isSS=false})
  r.addEventListener('scroll',()=>{if(isSS)return;isSS=true;tl.scrollTop=r.scrollTop;isSS=false})
}

// === MODAL: PROJECTS ===
function openProjModal(){
  renderProjList()
  openModalBackdrop('proj-modal-bd','#new-proj-name')
}
function closeProjModal(){
  closeModalBackdrop('proj-modal-bd')
}
function renderProjList(){
  const pl=document.getElementById('proj-list');pl.innerHTML=''
  if(!state.projects.length){const e=document.createElement('div');e.style.cssText='padding:14px;font-size:12px;color:var(--txt3)';e.textContent='No projects yet — create one below';pl.appendChild(e);return}
  const frag=document.createDocumentFragment()
  state.projects.forEach(p=>{
    const item=document.createElement('div');item.className=`proj-item${p.id===state.currentProjectId?' active':''}`;item.onclick=()=>selectProject(p.id)
    const dot=document.createElement('div');dot.className='proj-dot';dot.style.background=p.color||'#3B00FF'
    const tw=document.createElement('div');tw.style.flex='1';const nm=document.createElement('div');nm.className='proj-item-name';nm.textContent=p.name||'';const sb=document.createElement('div');sb.className='proj-item-sub';sb.textContent=p.description||'No description'
    const eb=document.createElement('button');eb.className='act';eb.title='Rename';eb.textContent='✎';eb.onclick=e=>{e.stopPropagation();renameProject(p.id,p.name||'')}
    tw.appendChild(nm);tw.appendChild(sb);item.appendChild(dot);item.appendChild(tw);item.appendChild(eb);frag.appendChild(item)
  })
  pl.appendChild(frag)
}

// === SIDEBAR ACCORDION ===
function toggleSubmenu(submenuId, element) {
  const submenu = document.getElementById(submenuId);
  if (!submenu) return;
  submenu.classList.toggle('expanded');
  element.classList.toggle('open');
}

function renderSidebarProjects() {
  const submenu = document.getElementById('projects-submenu');
  if (!submenu) return;
  submenu.innerHTML = '';
  if (!state.projects.length) {
    const empty = document.createElement('div');
    empty.className = 'submenu-item';
    empty.style.cssText = 'font-style:italic;font-size:12px;opacity:0.6';
    empty.textContent = 'No projects yet';
    submenu.appendChild(empty);
    return;
  }
  const frag = document.createDocumentFragment();
  state.projects.forEach(p => {
    const item = document.createElement('div');
    item.className = 'submenu-item' + (p.id === state.currentProjectId ? ' active' : '');
    item.onclick = () => selectProject(p.id);
    const dot = document.createElement('span');
    dot.className = 'status-dot';
    dot.style.background = p.color || '#7C3AED';
    const text = document.createElement('span');
    text.className = 'submenu-text';
    text.textContent = p.name || 'Untitled';
    item.appendChild(dot);
    item.appendChild(text);
    frag.appendChild(item);
  });
  submenu.appendChild(frag);
}

async function selectProject(id){
  state.currentProjectId=id;state.comparedBaseline=null
  selectedTaskIds.clear();closeDetailPanel()
  const p=state.projects.find(x=>x.id===id);document.getElementById('proj-name').textContent=p?.name||'—'
  document.getElementById('btn-link').disabled=false;document.getElementById('btn-clear').disabled=false
  closeProjModal();showL();await loadTasks();await loadDeps();await loadBaselines();await loadTaskLogs();hideL();render();triggerAutoFitOnNextPaint();renderSidebarProjects()
}
async function renameProject(id,oldName){
  const newName=await customPrompt('ชื่อโปรเจกต์ใหม่:',oldName)
  if(!newName||newName===oldName)return
  const{error}=await db.from('projects').update({name:newName}).eq('id',id)
  if(error){toast('❌ เปลี่ยนชื่อไม่สำเร็จ: '+error.message);return}
  const p=state.projects.find(x=>x.id===id);if(p)p.name=newName
  if(state.currentProjectId===id)document.getElementById('proj-name').textContent=newName
  renderProjList();renderSidebarProjects()
  toast('✅ เปลี่ยนชื่อโปรเจกต์สำเร็จ')
}
async function createProject(){
  const name=document.getElementById('new-proj-name').value.trim();if(!name){toast('⚠️ Please enter a project name');return}
  const{data,error}=await db.from('projects').insert({name}).select().single();if(error){toast('❌ Failed to create project: '+error.message);return}
  document.getElementById('new-proj-name').value='';await loadProjects();renderProjList();toast('✅ Project '+name+' created');selectProject(data.id)
}

async function saveBaseline(){
  if(!state.currentProjectId){openProjModal();return}if(!state.tasks.length){toast('⚠️ No tasks to save as Baseline');return}
  const name=await customPrompt('Baseline name',`Baseline ${fmt(new Date())}`);if(name===null)return;const tr=name.trim();if(!tr){toast('⚠️ Please enter a Baseline name');return}
  const{error}=await db.from('baselines').insert({project_id:state.currentProjectId,name:tr,snapshot_json:JSON.stringify(state.tasks)})
  if(error){toast('❌ Failed to save Baseline: '+error.message);return}await loadBaselines();toast('✅ Baseline saved')
}
async function compareBaseline(){
  if(!state.currentProjectId){openProjModal();return}if(!state.baselines.length){toast('⚠️ No Baselines saved yet');return}
  const opts=state.baselines.map((b,i)=>`${i+1}. ${b.name}`).join('\n')
  const pick=await customPrompt(`Select Baseline\n0. None\n${opts}`,'1');if(pick===null)return
  const idx=Number(pick);if(idx===0){state.comparedBaseline=null;render();toast('ℹ️ Comparison off');return}
  if(!Number.isInteger(idx)||idx<1||idx>state.baselines.length){toast('⚠️ Invalid selection');return}
  const sel=state.baselines[idx-1]
  try{const tasks=JSON.parse(sel.snapshot_json||'[]');if(!Array.isArray(tasks))throw new Error();state.comparedBaseline={id:sel.id,name:sel.name,tasks};render();toast(`✅ Comparing with ${sel.name}`)}
  catch{toast('❌ Failed to read Baseline data')}
}

// === MODAL: TASKS ===
function applyTaskModalGuards(taskId){
  const typeEl=document.getElementById('t-type')
  const startEl=document.getElementById('t-start')
  const durationEl=document.getElementById('t-duration')
  const progressSlideEl=document.getElementById('t-progress-slide')
  const progressNumEl=document.getElementById('t-progress-num')
  const parentLocked=!!taskId&&state.tasks.some(c=>c.parent_id===taskId)
  const isMilestone=typeEl.value==='milestone'
  const lockDateProgress=parentLocked||isMilestone
  ;[startEl,progressSlideEl,progressNumEl].forEach(el=>{
    el.disabled=lockDateProgress
    el.style.backgroundColor=lockDateProgress?'#f8fafc':''
  })
  if(isMilestone){
    durationEl.value=1
  }
  durationEl.disabled=lockDateProgress
  durationEl.style.backgroundColor=lockDateProgress?'#f8fafc':''
  calcTaskEndDate()
}

function openTaskModal(taskId){
  if(!state.currentProjectId){openProjModal();return}
  state.editingTaskId=taskId||null
  const isEdit=!!taskId
  const t=isEdit?state.tasks.find(x=>x.id===taskId):null
  const deleteBtn=document.getElementById('btn-del-task')
  const isLocked=!!t?.locked
  // Header
  document.getElementById('modal-title-icon').textContent=isEdit?'✎':'+'
  document.getElementById('modal-title-text').textContent=isEdit?'Edit Task':'Add Task'
  deleteBtn.style.display=isEdit&&!isLocked?'inline-flex':'none'
  deleteBtn.disabled=isLocked
  // Basic fields
  document.getElementById('t-name').value=t?.name||''
  document.getElementById('t-type').value=t?.type||'task'
  document.getElementById('t-category').value=t?.category||'General'
  document.getElementById('t-start').value=t?.start_date||fmtISO(new Date())
  document.getElementById('t-duration').value=t?.duration_days||5
  // Progress (keep slider + number in sync)
  const pct=t?.progress_pct||0
  document.getElementById('t-progress-slide').value=pct
  document.getElementById('t-progress-num').value=pct
  // Other fields
  document.getElementById('t-assignee').value=t?.assignee||''
  document.getElementById('t-locked').checked=!!(t?.locked)
  // Status flags
  const st=t?.status||''
  document.getElementById('f-cancelled').checked=st==='Cancelled'
  document.getElementById('f-onhold').checked=st==='On Hold'
  document.getElementById('f-delayed').checked=st==='Delayed'
  // Parent dropdown
  populateParentSel(t?.parent_id||null)
  applyTaskModalGuards(taskId)
  // Tabs: show only when editing, always reset to Details tab
  const tabsEl=document.getElementById('task-modal-tabs')
  tabsEl.style.display=isEdit?'flex':'none'
  document.querySelectorAll('.tm-tab').forEach(b=>b.classList.remove('active'))
  document.querySelectorAll('.tm-pane').forEach(p=>p.classList.remove('active'))
  document.getElementById('tm-tab-details').classList.add('active')
  document.getElementById('tm-pane-details').classList.add('active')
  if(isEdit)_updateLogBadge(taskId)
  // Sync log progress slider with task progress
  document.getElementById('tl-pct-slide').value=pct
  document.getElementById('tl-pct-num').value=pct
  openModalBackdrop('task-modal-bd','#t-name')
}
function openAddModal(){openTaskModal(null)}
function openEditModal(id){openTaskModal(id)}
function switchTaskModalTab(tab,el){
  document.querySelectorAll('.tm-tab').forEach(b=>b.classList.remove('active'))
  document.querySelectorAll('.tm-pane').forEach(p=>p.classList.remove('active'))
  el.classList.add('active')
  document.getElementById('tm-pane-'+tab).classList.add('active')
  if(tab==='log')renderTaskLogPane(state.editingTaskId)
}
function renderTaskLogPane(taskId){
  const list=document.getElementById('tl-log-list')
  if(!list)return
  const logs=(state.taskLogs[taskId]||[])
  if(!logs.length){list.innerHTML='<div class="tl-log-empty">ยังไม่มีบันทึก</div>';return}
  const EN_MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const groups={}
  logs.forEach(l=>{
    const key=l.logged_at.slice(0,7)
    if(!groups[key])groups[key]=[]
    groups[key].push(l)
  })
  list.innerHTML=Object.keys(groups).sort((a,b)=>b.localeCompare(a)).map(key=>{
    const[y,m]=key.split('-')
    const hdr=`${EN_MON[parseInt(m,10)-1]} ${y}`
    const rows=groups[key].map(l=>{
      const d=new Date(l.logged_at)
      const ds=`${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
      return `<div class="tl-log-entry">
        <div class="tl-log-meta">
          <span class="tl-log-pct">${l.progress_pct}%</span>
          <span class="tl-log-date">${ds}</span>
          ${l.logged_by?`<span style="font-size:11px;color:var(--txt3)">${esc(l.logged_by)}</span>`:''}
          <button class="tl-log-del" onclick="deleteTaskLog('${l.id}')" title="ลบ">✕</button>
        </div>
        <div class="tl-log-note">${esc(l.note||'')}</div>
      </div>`
    }).join('')
    return `<div class="tl-month-group"><div class="tl-month-hdr">${hdr}</div>${rows}</div>`
  }).join('')
}
function _updateLogBadge(taskId){
  const badge=document.getElementById('tm-log-badge')
  if(!badge)return
  const n=(state.taskLogs[taskId]||[]).length
  badge.textContent=n
  badge.style.display=n?'inline':'none'
}
async function addTaskLog(){
  if(!state.editingTaskId||!state.currentProjectId)return
  const note=document.getElementById('tl-note').value.trim()
  if(!note){toast('⚠️ กรุณากรอกบันทึก');return}
  const pct=Math.min(100,Math.max(0,parseInt(document.getElementById('tl-pct-num').value)||0))
  const t=state.tasks.find(x=>x.id===state.editingTaskId)
  const btn=document.querySelector('#tm-pane-log .mbtn.save')
  if(btn)btn.disabled=true
  const {data,error}=await db.from('task_logs').insert({
    task_id:state.editingTaskId,
    project_id:state.currentProjectId,
    note,
    progress_pct:pct,
    logged_by:t?.assignee||''
  }).select().single()
  if(btn)btn.disabled=false
  if(error){toast('❌ บันทึกไม่สำเร็จ: '+error.message);return}
  if(!state.taskLogs[state.editingTaskId])state.taskLogs[state.editingTaskId]=[]
  state.taskLogs[state.editingTaskId].unshift(data)
  document.getElementById('tl-note').value=''
  renderTaskLogPane(state.editingTaskId)
  _updateLogBadge(state.editingTaskId)
  toast('✅ บันทึกเรียบร้อย')
}
function deleteTaskLog(logId){
  showConfirm('ลบบันทึกนี้?',async()=>{
    const {error}=await db.from('task_logs').delete().eq('id',logId)
    if(error){toast('❌ ลบไม่สำเร็จ: '+error.message);return}
    for(const tid in state.taskLogs){
      state.taskLogs[tid]=state.taskLogs[tid].filter(l=>l.id!==logId)
    }
    renderTaskLogPane(state.editingTaskId)
    _updateLogBadge(state.editingTaskId)
    toast('🗑 ลบบันทึกแล้ว')
  })
}
function closeTaskModal(){
  closeModalBackdrop('task-modal-bd')
  state.editingTaskId=null
  render()
}
function showConfirm(message,callback){
  document.getElementById('confirm-msg').textContent=message
  confirmCallback=callback
  openModalBackdrop('confirm-modal-bd','#confirm-btn')
}
function closeConfirmModal(){
  closeModalBackdrop('confirm-modal-bd')
  confirmCallback=null
}
// === MODAL: SETTINGS ===
function openSettings(){
  const s=state.settings
  // Appearance
  const fontEl=document.getElementById('set-font')
  if(fontEl)Array.from(fontEl.options).forEach(o=>{o.selected=o.value===s.fontFamily})
  const dfEl=document.getElementById('set-date-fmt')
  if(dfEl)Array.from(dfEl.options).forEach(o=>{o.selected=o.value===s.dateFmt})
  // Theme
  document.getElementById('set-nav-bg').value=s.navBg||'#0a0f1e'
  document.getElementById('set-parent-color').value=s.parentColor||'#1e3a8a'
  document.getElementById('set-child-color').value=s.childColor||'#6366f1'
  // Gantt Grid
  document.getElementById('set-today-col').value=s.todayCol||'#e11d48'
  document.getElementById('set-wknd-bg').value=s.wkndBg||'#fcf0f0'
  document.getElementById('set-wknd-txt').value=s.wkndTxt||'#d32f2f'
  document.getElementById('set-grid-line').value=s.gridLineCol||'#e2e8f0'
  // Status Colors
  buildStatusSettingsBody()
  // Calendar
  const skipWeekendsEl=document.getElementById('set-skip-weekends')
  if(skipWeekendsEl)skipWeekendsEl.checked=!!state.skipWeekends
  document.getElementById('set-weekends-group').querySelectorAll('input[type=checkbox]').forEach(cb=>{cb.checked=(s.weekendDays||[0,6]).includes(parseInt(cb.value))})
  document.getElementById('set-hol-col').value=s.holCol||'#fef08a'
  renderHolidayList()
  renderCategorySettingsList()
  switchSetTab('appearance',document.querySelector('.set-tab'))
  openModalBackdrop('settings-modal-bd','#settings-modal .set-tab.active')
}
function switchSetTab(id,el){
  document.querySelectorAll('#settings-modal .set-pane').forEach(p=>p.classList.remove('active'))
  document.querySelectorAll('#settings-modal .set-tab').forEach(b=>b.classList.remove('active'))
  document.getElementById('set-'+id).classList.add('active')
  el.classList.add('active')
}
function buildStatusSettingsBody(){
  const tbody=document.getElementById('status-settings-body');if(!tbody)return
  const overrides=state.settings.statusOverrides||{}
  const rows=[{key:'Not Started',def:'#94a3b8'},{key:'In Progress',def:'#3b82f6'},{key:'Completed',def:'#22c55e'},{key:'Delayed',def:'#f59e0b'},{key:'On Hold',def:'#8b5cf6'},{key:'Cancelled',def:'#ef4444'}]
  tbody.innerHTML=rows.map(({key,def})=>{
    const ov=overrides[key]||{color:def,override:false}
    const pStyle=ov.override?`background:${ov.color}22;color:${ov.color};border:1px solid ${ov.color}44`:''
    return`<tr>
      <td style="font-size:13px;color:var(--txt2)">${key}</td>
      <td style="text-align:center"><input type="checkbox" class="status-ov-chk" data-status="${key}"${ov.override?' checked':''}></td>
      <td><input type="color" class="status-ov-col" data-status="${key}" value="${ov.color||def}"></td>
      <td><span class="status-badge-preview sbadge" style="${pStyle}">${key}</span></td>
    </tr>`
  }).join('')
}
function resetDefaults(){
  state.settings=Object.assign({},DEFAULT_SETTINGS,{holidays:[...DEFAULT_SETTINGS.holidays],statusOverrides:JSON.parse(JSON.stringify(DEFAULT_SETTINGS.statusOverrides))})
  state.skipWeekends=false
  localStorage.setItem('gaScheduleSkipWeekends',JSON.stringify(state.skipWeekends))
  invalidateCalendarCache()
  openSettings()
  toast('↺ Reset to defaults')
}
function addHoliday(){
  const dateEl=document.getElementById('new-hol-date'),nameEl=document.getElementById('new-hol-name')
  const date=dateEl.value,name=nameEl.value.trim()||'Holiday'
  if(!date){toast('⚠️ Please select a date');return}
  if(!state.settings.holidays)state.settings.holidays=[]
  if(state.settings.holidays.some(h=>h.date===date)){toast('⚠️ Date already added');return}
  state.settings.holidays.push({date,name})
  state.settings.holidays.sort((a,b)=>a.date.localeCompare(b.date))
  dateEl.value='';nameEl.value=''
  invalidateCalendarCache()
  renderHolidayList()
}
function renderHolidayList(){
  const tbody=document.getElementById('holiday-settings-body');if(!tbody)return
  const holidays=state.settings.holidays||[]
  if(!holidays.length){tbody.innerHTML='<tr><td colspan="3" style="text-align:center;color:var(--txt3);padding:10px;font-size:12px">No holidays added</td></tr>';return}
  tbody.innerHTML=holidays.map((h,i)=>`<tr>
    <td style="font-family:var(--mono);font-size:12px;color:var(--txt3)">${h.date}</td>
    <td style="font-size:13px;color:var(--txt2)">${esc(h.name)}</td>
    <td style="text-align:center"><button class="act del" onclick="removeHoliday(${i})" title="Remove">🗑</button></td>
  </tr>`).join('')
}
function removeHoliday(i){
  state.settings.holidays.splice(i,1)
  invalidateCalendarCache()
  renderHolidayList()
}
function closeSettings(){
  closeModalBackdrop('settings-modal-bd')
}
function toggleSkipWeekends(checked){
  state.skipWeekends=!!checked
  localStorage.setItem('gaScheduleSkipWeekends',JSON.stringify(state.skipWeekends))
  if(document.getElementById('task-modal-bd').classList.contains('show'))calcTaskEndDate()
  render()
}
// === MODAL: DEPENDENCIES ===
function openDependencyModal(){
  if(!state.currentProjectId){openProjModal();return}
  if(!state.tasks.length){toast('⚠️ Add a task first');return}
  const opts=state.tasks.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('')
  document.getElementById('ds-from').innerHTML=`<option value="">— From Task —</option>${opts}`
  document.getElementById('ds-to').innerHTML=`<option value="">— To Task —</option>${opts}`
  if(state.tasks.length>1)document.getElementById('ds-to').selectedIndex=2
  renderDepTable()
  openModalBackdrop('dep-unified-modal-bd','#ds-from')
}
function closeDependencyModal(){
  closeModalBackdrop('dep-unified-modal-bd')
}
async function saveSimpleDep(){
  if(!state.currentProjectId)return
  const fid=document.getElementById('ds-from').value,tid=document.getElementById('ds-to').value
  if(!fid||!tid){toast('⚠️ Please select both tasks');return}
  if(fid===tid){toast('⚠️ Cannot link a task to itself');return}
  if(state.deps.some(d=>d.from_task_id===fid&&d.to_task_id===tid&&d.dep_type==='FS')){toast('⚠️ This FS link already exists');return}
  const{error}=await db.from('dependencies').insert({project_id:state.currentProjectId,from_task_id:fid,to_task_id:tid,dep_type:'FS'})
  if(error){toast('❌ Failed to save link: '+error.message);return}
  await loadDeps();render();renderDepTable();toast('✅ FS link added')
}
function renderDepTable(){
  const tbody=document.getElementById('dep-list-body');if(!tbody)return
  const taskMap=new Map(state.tasks.map(t=>[t.id,t]))
  if(!state.deps.length){
    tbody.innerHTML=`<tr><td colspan="4" style="padding:14px;text-align:center;color:var(--txt3);font-size:12px">No links in this project</td></tr>`
    return
  }
  tbody.innerHTML=state.deps.map(d=>{
    const fn=esc((taskMap.get(d.from_task_id)||{name:'—'}).name)
    const tn=esc((taskMap.get(d.to_task_id)||{name:'—'}).name)
    return `<tr style="border-bottom:1px solid var(--bdr)">
      <td style="padding:6px 10px;font-size:12px;color:var(--txt2);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${fn}</td>
      <td style="padding:6px 10px;font-family:var(--mono);font-size:10px;font-weight:600;color:#3B00FF">${d.dep_type}</td>
      <td style="padding:6px 10px;font-size:12px;color:var(--txt2);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${tn}</td>
      <td style="padding:6px 10px;text-align:center"><button class="act del" onclick="confirmDeleteDep('${d.id}')" title="Delete link">🗑</button></td>
    </tr>`
  }).join('')
}
function confirmDeleteDep(id){
  showConfirm('Delete this dependency link?',async()=>{
    const{error}=await db.from('dependencies').delete().eq('id',id)
    if(error){toast('❌ Failed to delete link');return}
    await loadDeps();render();renderDepTable();toast('🗑 Link removed')
  })
}
function applySettings(){
  const s=state.settings,r=document.documentElement
  // Appearance
  s.fontFamily=document.getElementById('set-font').value
  s.dateFmt=document.getElementById('set-date-fmt').value
  document.body.style.fontFamily=s.fontFamily
  // Theme
  s.navBg=document.getElementById('set-nav-bg').value
  s.parentColor=document.getElementById('set-parent-color').value
  s.childColor=document.getElementById('set-child-color').value
  r.style.setProperty('--nav-bg',s.navBg)
  r.style.setProperty('--parent-task-color',s.parentColor)
  r.style.setProperty('--child-task-color',s.childColor)
  // Gantt Grid
  s.todayCol=document.getElementById('set-today-col').value
  s.wkndBg=document.getElementById('set-wknd-bg').value
  s.wkndTxt=document.getElementById('set-wknd-txt').value
  s.gridLineCol=document.getElementById('set-grid-line').value
  r.style.setProperty('--today-col',s.todayCol)
  r.style.setProperty('--weekend-bg-color',s.wkndBg)
  r.style.setProperty('--weekend-text-color',s.wkndTxt)
  r.style.setProperty('--grid-line-color',s.gridLineCol)
  // Status Overrides
  const statusOverrides={}
  document.querySelectorAll('#status-settings-body tr').forEach(row=>{
    const chk=row.querySelector('.status-ov-chk'),col=row.querySelector('.status-ov-col')
    if(chk&&col)statusOverrides[chk.dataset.status]={color:col.value,override:chk.checked}
  })
  s.statusOverrides=statusOverrides
  // Calendar
  s.weekendDays=Array.from(document.getElementById('set-weekends-group').querySelectorAll('input:checked')).map(cb=>parseInt(cb.value))
  s.holCol=document.getElementById('set-hol-col').value
  r.style.setProperty('--holiday-color',s.holCol)
  localStorage.setItem('gaScheduleSettings',JSON.stringify(s))
  invalidateCalendarCache()
  populateCategoryDropdowns()
  closeSettings();render();toast('✅ Settings applied')
}
function loadSettings(){
  const saved=localStorage.getItem('gaScheduleSettings');if(!saved)return
  let d;try{d=JSON.parse(saved)}catch{return}
  Object.assign(state.settings,d)
  const r=document.documentElement,s=state.settings
  if(s.fontFamily)document.body.style.fontFamily=s.fontFamily
  if(s.navBg)r.style.setProperty('--nav-bg',s.navBg)
  if(s.parentColor)r.style.setProperty('--parent-task-color',s.parentColor)
  if(s.childColor)r.style.setProperty('--child-task-color',s.childColor)
  if(s.todayCol)r.style.setProperty('--today-col',s.todayCol)
  if(s.wkndBg)r.style.setProperty('--weekend-bg-color',s.wkndBg)
  if(s.wkndTxt)r.style.setProperty('--weekend-text-color',s.wkndTxt)
  if(s.gridLineCol)r.style.setProperty('--grid-line-color',s.gridLineCol)
  if(s.holCol)r.style.setProperty('--holiday-color',s.holCol)
  const savedSkipWeekends=localStorage.getItem('gaScheduleSkipWeekends')
  if(savedSkipWeekends!==null){
    try{state.skipWeekends=!!JSON.parse(savedSkipWeekends)}catch{state.skipWeekends=false}
  }
}
function populateParentSel(sel){
  const s=document.getElementById('t-parent');if(!s)return
  s.innerHTML='<option value="">None (Root)</option>'
  state.tasks.filter(t=>t.id!==state.editingTaskId).forEach(t=>{const o=document.createElement('option');o.value=t.id;o.textContent=t.name;if(t.id===sel)o.selected=true;s.appendChild(o)})
}

function calcTaskEndDate(){
  const s=document.getElementById('t-start').value
  const d=parseInt(document.getElementById('t-duration').value)||0
  if(!s||d<1){document.getElementById('t-end').value='';return}
  let end=new Date(pd(s))
  if(state.skipWeekends){
    end=addWD(pd(s),d)
  }else{
    end.setDate(end.getDate()+(d-1))
  }
  document.getElementById('t-end').value=fmtISO(end)
}

// === TASK CRUD ===
async function saveTask(){
  const btn=document.getElementById('btn-save-task');if(btn)btn.disabled=true
  try{
  const name=document.getElementById('t-name').value.trim();if(!name){toast('⚠️ Please enter a task name');return}
  pushHistory()
  const pct=Math.min(100,Math.max(0,parseInt(document.getElementById('t-progress-num').value)||0))
  const isCancelled=document.getElementById('f-cancelled').checked
  const isOnHold=document.getElementById('f-onhold').checked
  const isDelayed=document.getElementById('f-delayed').checked
  let status
  if(isCancelled)status='Cancelled'
  else if(isOnHold)status='On Hold'
  else if(isDelayed)status='Delayed'
  else if(pct===100)status='Completed'
  else if(pct>0)status='In Progress'
  else status='Not Started'
  const locked=document.getElementById('t-locked').checked
  const payload={project_id:state.currentProjectId,parent_id:document.getElementById('t-parent').value||null,name,type:document.getElementById('t-type').value,category:document.getElementById('t-category').value,start_date:document.getElementById('t-start').value,duration_days:parseInt(document.getElementById('t-duration').value)||1,progress_pct:pct,status,assignee:document.getElementById('t-assignee').value||null,locked,sort_order:state.editingTaskId?undefined:state.tasks.length}
  setSS('⟳ Saving...')
  if(state.editingTaskId){
    const original=state.tasks.find(t=>t.id===state.editingTaskId)
    const prevSnapshot=new Map()
    state.tasks.forEach(t=>prevSnapshot.set(t.id,{start_date:t.start_date,duration_days:t.duration_days}))
    const{error}=await db.from('tasks').update(payload).eq('id',state.editingTaskId)
    if(error){toast('❌ Save failed: '+error.message);setSS('✗ Error');return}

    if(original){
      original.start_date=payload.start_date
      original.duration_days=payload.duration_days
      try{
        const changedMap=cascadeDates(state.editingTaskId)
        await persistCascadedTasks(changedMap)
      }catch(err){
        prevSnapshot.forEach((v,id)=>{const t=state.tasks.find(x=>x.id===id);if(t){t.start_date=v.start_date;t.duration_days=v.duration_days}})
        toast('❌ Cascade save failed: '+err.message)
        setSS('✗ Error')
        await loadTasks()
        return
      }
    }
  }
  else{
    const{error}=await db.from('tasks').insert(payload)
    if(error){toast('❌ Save failed: '+error.message);setSS('✗ Error');return}
  }
  if(payload.parent_id)state.collapsed[payload.parent_id]=false
  await loadTasks();setSS('✓ Synced');toast('✅ Task saved');closeTaskModal()
  }finally{if(btn)btn.disabled=false}
}
async function deleteTask(){
  if(!state.editingTaskId)return;const t=state.tasks.find(x=>x.id===state.editingTaskId)
  showConfirm(`Delete "${t?.name}"? Subtasks will also be removed.`,async()=>{
    pushHistory()
    const ids=getDesc(state.editingTaskId);ids.push(state.editingTaskId);setSS('⟳ Deleting...')
    const{error}=await db.from('tasks').delete().in('id',ids);if(error){toast('❌ Delete failed');return}
    await loadTasks();await loadDeps();await loadTaskLogs();setSS('✓ Synced');toast('🗑 Task deleted');closeTaskModal()
  })
}
function confirmDelete(id){
  const t=state.tasks.find(x=>x.id===id)
  if(!t)return
  state.editingTaskId=id
  deleteTask()
}
function getDesc(id){
  const kids=state.tasks.filter(t=>t.parent_id===id).map(t=>t.id)
  return[...kids,...kids.flatMap(k=>getDesc(k))]
}

// === INLINE EDITING ===
async function patchTask(id,fields){
  const t=state.tasks.find(x=>x.id===id);if(!t)return
  setSS('⟳ Saving...')
  const{error}=await db.from('tasks').update(fields).eq('id',id)
  if(error){toast('❌ Save failed: '+error.message);setSS('✗ Error');render();return}
  pushHistory()
  Object.assign(t,fields)
  setSS('✓ Synced')
  render()
}
function inlineEditPct(el,id){
  const t=state.tasks.find(x=>x.id===id);if(!t)return
  const inp=document.createElement('input')
  inp.type='number';inp.min=0;inp.max=100;inp.value=t.progress_pct
  inp.className='inline-edit-input'
  el.replaceWith(inp);inp.focus();inp.select()
  let committed=false
  const commit=()=>{
    if(committed)return;committed=true
    const v=Math.min(100,Math.max(0,parseInt(inp.value)||0))
    const specialStatus=['Cancelled','On Hold','Delayed']
    const fields={progress_pct:v}
    if(!specialStatus.includes(t.status))fields.status=v===100?'Completed':v>0?'In Progress':'Not Started'
    patchTask(id,fields)
  }
  inp.onblur=commit
  inp.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();commit()}if(e.key==='Escape')render()}
}
function inlineEditName(el,id){
  const t=state.tasks.find(x=>x.id===id);if(!t)return
  const inp=document.createElement('input')
  inp.type='text';inp.value=t.name||''
  inp.className='inline-name-input'
  el.replaceWith(inp);inp.focus();inp.select()
  let committed=false
  const commit=()=>{
    if(committed)return;committed=true
    const newVal=inp.value.trim()||'Untitled Task'
    if(newVal!==t.name)patchTask(id,{name:newVal})
    else render()
  }
  inp.onblur=commit
  inp.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();commit()}if(e.key==='Escape')render()}
}
function inlineEditStatus(el,id){
  const t=state.tasks.find(x=>x.id===id);if(!t)return
  const STATUSES=['Not Started','In Progress','Completed','Delayed','On Hold','Cancelled']
  const sel=document.createElement('select')
  sel.className='inline-edit-select'
  sel.innerHTML=STATUSES.map(s=>`<option value="${s}"${t.status===s?' selected':''}>${s}</option>`).join('')
  el.replaceWith(sel);sel.focus()
  let committed=false
  const commit=()=>{
    if(committed)return;committed=true
    const fields={status:sel.value}
    if(sel.value==='Completed')fields.progress_pct=100
    else if(sel.value==='Not Started')fields.progress_pct=0
    patchTask(id,fields)
  }
  sel.onchange=commit
  sel.onblur=commit
  sel.onkeydown=e=>{if(e.key==='Escape')render()}
}

// === TASK DETAIL PANEL ===
let _detailPanelId=null
function openDetailPanel(id){
  const t=state.tasks.find(x=>x.id===id);if(!t)return
  _detailPanelId=id
  _renderDetailPanel(t)
  document.getElementById('detail-panel').classList.add('open')
  document.getElementById('detail-panel').setAttribute('aria-hidden','false')
}
function closeDetailPanel(){
  const p=document.getElementById('detail-panel');if(!p)return
  p.classList.remove('open')
  p.setAttribute('aria-hidden','true')
  _detailPanelId=null
}
function openEditFromPanel(){
  const id=_detailPanelId;closeDetailPanel();if(id)openEditModal(id)
}
function _renderDetailPanel(t){
  const pct=t.progress_pct||0
  const displayStatus=getDerivedStatus(t,pct)
  const sc=STATUS_CLASS[displayStatus]||'s-none'
  const ov=(state.settings.statusOverrides||{})[displayStatus]
  const badgeStyle=(ov&&ov.override&&ov.color)?`background:${ov.color}22;color:${ov.color};border:1px solid ${ov.color}44`:''
  const e=taskEnd(t)
  document.getElementById('dp-name').textContent=t.name||''
  const tb=document.getElementById('dp-type-badge')
  tb.textContent=t.type||'task';tb.className='dp-type-badge dp-type-'+(t.type||'task')
  document.getElementById('dp-status').innerHTML=`<span class="sbadge ${sc}" style="${badgeStyle}">${esc(STATUS_LABELS[displayStatus]||displayStatus)}</span>`
  document.getElementById('dp-pct').textContent=pct+'%'
  const fill=document.getElementById('dp-pbar-fill')
  fill.style.width=pct+'%';fill.style.background=pct===100?'var(--green)':'var(--nt-grad90)'
  document.getElementById('dp-start').textContent=fmtS(pd(t.start_date))
  document.getElementById('dp-end').textContent=t.type==='milestone'?'—':fmtS(e)
  document.getElementById('dp-dur').textContent=t.type==='milestone'?'—':t.duration_days+' days'
  document.getElementById('dp-assignee').textContent=t.assignee||'—'
  const catEl=document.getElementById('dp-category')
  catEl.innerHTML=`<span style="display:inline-flex;align-items:center;gap:5px"><span style="width:8px;height:8px;border-radius:50%;background:${getCatColor(t.category)};flex-shrink:0"></span>${esc(t.category||'General')}</span>`
  const parentRow=document.getElementById('dp-parent-row')
  if(t.parent_id){const p=state.tasks.find(x=>x.id===t.parent_id);document.getElementById('dp-parent').textContent=p?p.name:'—';parentRow.style.display=''}
  else parentRow.style.display='none'
  const depsSection=document.getElementById('dp-deps-section')
  const deps=state.deps.filter(d=>d.to_task_id===t.id||d.from_task_id===t.id)
  if(deps.length){
    document.getElementById('dp-deps').innerHTML=deps.map(d=>{
      const otherId=d.to_task_id===t.id?d.from_task_id:d.to_task_id
      const dir=d.to_task_id===t.id?'← from':'→ to'
      const other=state.tasks.find(x=>x.id===otherId)
      return`<div class="dp-dep-item">${dir} <span>${esc(other?.name||'—')}</span><span class="dep-type">${d.type||'FS'}</span></div>`
    }).join('')
    depsSection.style.display=''
  } else depsSection.style.display='none'
}

// === UNDO / REDO ===
function pushHistory(){
  _history.push(JSON.stringify(state.tasks))
  if(_history.length>HISTORY_LIMIT)_history.shift()
  _redoStack.length=0
  updateUndoRedoBtns()
}
async function undo(){
  if(!_history.length)return
  _redoStack.push(JSON.stringify(state.tasks))
  const prevTasks=state.tasks
  state.tasks=JSON.parse(_history.pop())
  updateUndoRedoBtns()
  render()
  await _syncHistoryState(prevTasks,state.tasks)
  toast('↩ Undone')
}
async function redo(){
  if(!_redoStack.length)return
  _history.push(JSON.stringify(state.tasks))
  const prevTasks=state.tasks
  state.tasks=JSON.parse(_redoStack.pop())
  updateUndoRedoBtns()
  render()
  await _syncHistoryState(prevTasks,state.tasks)
  toast('↪ Redone')
}
async function _syncHistoryState(fromTasks,toTasks){
  if(!state.currentProjectId)return
  setSS('⟳ Syncing...')
  const toIds=new Set(toTasks.map(t=>t.id))
  const removed=fromTasks.filter(t=>!toIds.has(t.id)).map(t=>t.id)
  if(removed.length){const{error}=await db.from('tasks').delete().in('id',removed);if(error){setSS('✗ Error');return}}
  if(toTasks.length){const{error}=await db.from('tasks').upsert(toTasks,{onConflict:'id'});if(error){setSS('✗ Error');return}}
  setSS('✓ Synced')
}
function updateUndoRedoBtns(){
  const u=document.getElementById('btn-undo'),r=document.getElementById('btn-redo')
  if(u)u.disabled=!_history.length
  if(r)r.disabled=!_redoStack.length
}

// === BULK OPERATIONS ===
function toggleTaskSelection(id){
  if(!id)return
  if(selectedTaskIds.has(id))selectedTaskIds.delete(id)
  else selectedTaskIds.add(id)
  const row=document.querySelector(`.trow[data-id="${id}"]`)
  if(row){
    row.classList.toggle('is-bulk-selected',selectedTaskIds.has(id))
    const chk=row.querySelector('.row-chk');if(chk)chk.checked=selectedTaskIds.has(id)
  }
  renderBulkBar()
}
function selectAll(){
  getFilteredVisible().forEach(({task})=>selectedTaskIds.add(task.id))
  renderBulkBar()
  render()
}
function deselectAll(){
  selectedTaskIds.clear()
  document.querySelectorAll('.trow.is-bulk-selected').forEach(r=>{
    r.classList.remove('is-bulk-selected')
    const chk=r.querySelector('.row-chk');if(chk)chk.checked=false
  })
  renderBulkBar()
}
function renderBulkBar(){
  const bar=document.getElementById('bulk-bar'),cnt=document.getElementById('bulk-count')
  if(!bar)return
  const n=selectedTaskIds.size
  bar.classList.toggle('hidden',n===0)
  if(cnt)cnt.textContent=`${n} task${n===1?'':'s'} selected`
  const hdrChk=document.getElementById('hdr-select-all')
  if(hdrChk){
    const visible=getFilteredVisible()
    hdrChk.checked=visible.length>0&&visible.every(({task})=>selectedTaskIds.has(task.id))
    hdrChk.indeterminate=n>0&&!hdrChk.checked
  }
}
async function bulkDelete(){
  if(!selectedTaskIds.size)return
  const n=selectedTaskIds.size
  showConfirm(`Delete ${n} selected task${n>1?'s':''}? Subtasks will also be removed.`,async()=>{
    pushHistory()
    const ids=[...selectedTaskIds]
    const allIds=[...new Set([...ids,...ids.flatMap(id=>getDesc(id))])]
    setSS('⟳ Deleting...')
    const{error}=await db.from('tasks').delete().in('id',allIds)
    if(error){toast('❌ Delete failed: '+error.message);setSS('✗ Error');return}
    selectedTaskIds.clear()
    await loadTasks();await loadDeps();setSS('✓ Synced');toast(`🗑 ${n} task${n>1?'s':''} deleted`)
    renderBulkBar()
  })
}
async function bulkChangeStatus(newStatus){
  if(!selectedTaskIds.size||!newStatus)return
  const ids=[...selectedTaskIds]
  const fields={status:newStatus}
  if(newStatus==='Completed')fields.progress_pct=100
  else if(newStatus==='Not Started')fields.progress_pct=0
  pushHistory()
  setSS('⟳ Updating...')
  const{error}=await db.from('tasks').update(fields).in('id',ids)
  if(error){toast('❌ Update failed: '+error.message);setSS('✗ Error');return}
  ids.forEach(id=>{const t=state.tasks.find(x=>x.id===id);if(t)Object.assign(t,fields)})
  setSS('✓ Synced');toast(`✅ ${ids.length} task${ids.length>1?'s':''} updated`)
  render()
}

// === TOOLBAR ACTIONS ===
function setZoom(level){
  state.zoomLevel=level
  ;['day','week','month'].forEach(m=>document.getElementById('tab-'+m).classList.toggle('active',m===level))
  render()
}
// Suppress all CSS transitions during JS-driven layout mutations so nothing slides.
function disableTransitions(){document.documentElement.classList.add('no-transitions')}
function enableTransitions(){requestAnimationFrame(()=>requestAnimationFrame(()=>document.documentElement.classList.remove('no-transitions')))}

function autoFitAll(){
  disableTransitions()
  const colCount=11
  // Reset to defaults ก่อนวัด เพื่อป้องกัน Task Name (คอลัมน์ที่ขยายได้) จำค่าที่ถูกยืดค้างไว้
  state.colWidths=[...DEFAULT_COL_WIDTHS]

  for(let colIndex=0;colIndex<colCount;colIndex++){
    let maxWidth=0
    document.querySelectorAll(`#col-hdr > *:nth-child(${colIndex+1}), .trow > *:nth-child(${colIndex+1})`).forEach(cell=>{
      const clone=cell.cloneNode(true)
      clone.style.cssText='position:absolute;visibility:hidden;width:auto;max-width:none;white-space:nowrap;overflow:visible;display:inline-block;z-index:-9999'
      clone.querySelectorAll('*').forEach(el=>{el.style.overflow='visible';el.style.maxWidth='none';el.style.width='auto'})
      document.body.appendChild(clone)
      maxWidth=Math.max(maxWidth,clone.getBoundingClientRect().width)
      clone.remove()
    })
    state.colWidths[colIndex]=Math.min(Math.max(maxWidth+16,30),600)
  }

  // ใช้ CSS variable ใหม่ก่อน
  applyColumnWidths()

  const leftPanel=document.getElementById('left')
  const colHeader=document.getElementById('col-hdr')
  if(leftPanel&&colHeader){
    // 1. ปลดล็อกความกว้างที่ splitter บังคับไว้ → ให้ CSS Grid ขยาย/หดตามเนื้อหาจริง
    leftPanel.style.width='max-content'
    // 2. บังคับ sync reflow → วัดความกว้างที่แท้จริง (ไม่ใช่ scrollWidth ที่ถูก clamp โดย container)
    const naturalWidth=colHeader.offsetWidth
    // 3. ล็อกกลับเป็น px ให้ splitter ยังลากได้ปกติ
    leftPanel.style.width=Math.min(Math.max(naturalWidth,320),window.innerWidth*0.8)+'px'
  }

  render()
  enableTransitions()
  toast('✅ จัดขนาดคอลัมน์อัตโนมัติสำเร็จ')
}
function triggerAutoFitOnNextPaint(delay=50){
  setTimeout(()=>{if(typeof autoFitAll==='function')autoFitAll()},delay)
}
function expandAll(){
  state.collapsed={}
  render()
}
function collapseAll(){
  const parentIds=new Set(state.tasks.filter(t=>t.parent_id).map(t=>t.parent_id))
  parentIds.forEach(id=>{state.collapsed[id]=true})
  render()
}
function scrollToday(){
  const{min}=getMinMax()
  document.getElementById('right').scrollLeft=Math.max(0,dBetween(min,new Date())*getPxPerDay()-120)
}

async function saveAll(){
  if(!state.currentProjectId)return
  setSS('⟳ Saving...')
  showL()
  await loadTasks()
  await loadDeps()
  await loadTaskLogs()
  hideL()
  render()
  lastSavedAt=new Date()
  setSS(`✓ Saved ${fmtTime(lastSavedAt)}`)
  toast('✅ Synced with Supabase')
}
async function clearProject(){
  if(!state.currentProjectId)return
  showConfirm('Are you sure you want to clear ALL tasks? This action cannot be undone.',async()=>{
    setSS('⟳ Clearing...')
    const{error}=await db.from('tasks').delete().eq('project_id',state.currentProjectId)
    if(error){toast('❌ Failed to clear project: '+error.message);setSS('✗ Error');return}
    await loadTasks();await loadDeps();await loadTaskLogs();setSS('✓ Synced');render();toast('🗑 Project cleared')
  })
}
// === EXPORT ===

// Walks every element in a cloned DOM tree and replaces any inline background
// or backgroundImage that contains a gradient (or a CSS var that resolves to one).
// CSS `!important` rules cannot override inline styles, so this must be done in JS.
function stripGradientsFromClone(root){
  const GRAD_RE=/gradient|var\(--nt-grad/i
  const SOLID_FALLBACKS={
    'gb-general':'#4F46E5','gb-develop':'#059669','gb-test':'#34D399',
    'gb-meeting':'#F59E0B','gb-parent':'#1E3A8A','gb-cancel':'#e2e8f0',
    'gbar-fill':'rgba(255,255,255,.28)','pbar-fill':'#4F46E5',
    'kb-pbar':'#4F46E5','gms':'#4F46E5'
  }
  root.querySelectorAll('*').forEach(el=>{
    // Resolve a solid fallback from the element's CSS classes
    let solidFallback=null
    for(const cls of el.classList){if(SOLID_FALLBACKS[cls]){solidFallback=SOLID_FALLBACKS[cls];break}}

    // Strip inline background if it contains a gradient or unresolvable CSS var
    const inlineBg=el.style.background||''
    const inlineBgImg=el.style.backgroundImage||''
    if(GRAD_RE.test(inlineBg)){
      el.style.background=solidFallback||'transparent'
      el.style.backgroundImage='none'
    } else if(GRAD_RE.test(inlineBgImg)){
      el.style.backgroundImage='none'
      if(solidFallback&&!el.style.backgroundColor)el.style.backgroundColor=solidFallback
    }

    // Strip box-shadow referencing CSS vars (avoids secondary canvas errors)
    if(el.style.boxShadow&&el.style.boxShadow.includes('var('))el.style.boxShadow='none'
  })
}

function exportCSV(){
  const {wbs} = getWBS();
  const rows = [['WBS', 'Task Name', 'Type', 'Category', 'Start', 'End', 'Duration', '%', 'Status', 'Assignee']];
  
  getVisible().forEach(({task:t}) => {
    const hasKids=renderCache?.childMap?.has(t.id)??state.tasks.some(c=>c.parent_id===t.id)
    const {s:rs, e:re} = hasKids ? (getParentDates(t.id) || {s:pd(t.start_date), e:taskEnd(t)}) : {s:pd(t.start_date), e:taskEnd(t)};
    
    rows.push([wbs[t.id]||'', t.name, t.type, t.category, fmt(rs), fmt(re), t.duration_days+'d', t.progress_pct+'%', STATUS_LABELS[t.status]||t.status, t.assignee||'']);
  });

  const csv = '\uFEFF' + rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'ga-schedule.csv';
  a.click();
  toast('📊 CSV exported');
}
async function buildExportCanvas(){
  const left=document.getElementById('left')
  const right=document.getElementById('right')
  const stage=document.createElement('div')
  stage.style.cssText='position:fixed;left:-99999px;top:0;background:#f5f7fc;display:flex;align-items:flex-start;z-index:-1'

  const lc=left.cloneNode(true),rc=right.cloneNode(true)
  lc.style.cssText=`width:${left.offsetWidth}px;height:auto;overflow:visible`
  rc.style.cssText=`width:${Math.max(right.clientWidth,right.scrollWidth)}px;height:auto;overflow:visible`

  if(typeof stripGradientsFromClone==='function'){
    stripGradientsFromClone(lc)
    stripGradientsFromClone(rc)
  }

  const ganttHdrClone=rc.querySelector('#gantt-hdr')
  if(ganttHdrClone){
    ganttHdrClone.style.backdropFilter='none'
    ganttHdrClone.style.webkitBackdropFilter='none'
    ganttHdrClone.style.background='#F9FAFB'
    ganttHdrClone.style.backgroundImage='none'
  }

  stage.appendChild(lc)
  stage.appendChild(rc)
  document.body.appendChild(stage)

  const canvas=await window.html2canvas(stage,{backgroundColor:'#f5f7fc',scale:2,useCORS:true,logging:false})
  return{canvas,stage}
}

async function exportPNG(){
  if(!window.html2canvas){toast('❌ html2canvas not found');return}
  if(!state.currentProjectId){openProjModal();return}
  const pn=(state.projects.find(p=>p.id===state.currentProjectId)?.name||'project').replace(/[^\wก-๙-]+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'')||'project'
  showL();setSS('⟳ Generating PNG...')
  let stage=null
  try{
    document.body.classList.add('is-exporting')
    const built=await buildExportCanvas()
    const canvas=built.canvas
    stage=built.stage
    const a=document.createElement('a');a.href=canvas.toDataURL('image/png');a.download=`ga-schedule-${pn}-${fmt(new Date())}.png`;a.click()
    toast('🖼 PNG exported');setSS('✓ Synced')
  }catch(err){toast('❌ PNG export failed: '+err.message);setSS('⚠️ PNG error');console.error(err)}
  finally{if(stage&&stage.parentNode)stage.parentNode.removeChild(stage);document.body.classList.remove('is-exporting');hideL()}
}
async function exportPDF(){
  if(!window.html2canvas||!window.jspdf?.jsPDF){toast('❌ Library not found');return}
  if(!state.currentProjectId){openProjModal();return}
  const pnr=state.projects.find(p=>p.id===state.currentProjectId)?.name||'project'
  const pn=pnr.replace(/[^\wก-๙-]+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'')||'project'
  showL();setSS('⟳ Generating PDF...')
  let stage=null
  try{
    document.body.classList.add('is-exporting')
    const built=await buildExportCanvas()
    const canvas=built.canvas
    stage=built.stage
    const{jsPDF}=window.jspdf,pdf=new jsPDF({orientation:'landscape',unit:'mm',format:'a4'})
    const pw=pdf.internal.pageSize.getWidth(),m=8,imgW=pw-m*2
    const imgH=Math.min((canvas.height*imgW)/canvas.width,pdf.internal.pageSize.getHeight()-m*2-8)
    pdf.setFont('helvetica','bold');pdf.setFontSize(12);pdf.text(`GA Schedule: ${pnr}`,m,m+4)
    pdf.setFont('helvetica','normal');pdf.setFontSize(9);pdf.text(`Date: ${fmt(new Date())}`,pw-m,m+4,{align:'right'})
    pdf.addImage(canvas.toDataURL('image/png'),'PNG',m,m+8,imgW,imgH)
    pdf.save(`ga-schedule-${pn}-${fmt(new Date())}.pdf`)
    toast('📄 PDF exported');setSS('✓ Synced')
  }catch(err){toast('❌ PDF export failed: '+err.message);setSS('⚠️ PDF error');console.error(err)}
  finally{if(stage&&stage.parentNode)stage.parentNode.removeChild(stage);document.body.classList.remove('is-exporting');hideL()}
}

function exportJSON(){
  if(!state.currentProjectId){toast('⚠️ Select a project first');return}
  if(!state.tasks.length){toast('⚠️ No tasks to export');return}
  const data={version:1,exportDate:new Date().toISOString(),tasks:state.tasks,deps:state.deps}
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'})
  const url=URL.createObjectURL(blob)
  const a=document.createElement('a')
  a.href=url
  const pName=(document.getElementById('proj-name')?.textContent||'project').replace(/[^\wก-๙-]+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'')||'project'
  a.download=`ga-backup-${pName}-${fmtISO(new Date())}.json`
  document.body.appendChild(a);a.click();document.body.removeChild(a)
  URL.revokeObjectURL(url)
  toast('📦 Project Backup Exported')
}

function importJSON(e){
  const file=e.target.files[0]
  if(!file)return
  if(!state.currentProjectId){toast('⚠️ Please select or create a project first');e.target.value='';return}
  const reader=new FileReader()
  reader.onload=async(ev)=>{
    try{
      const data=JSON.parse(ev.target.result)
      if(!data.tasks||!Array.isArray(data.tasks)){toast('❌ Invalid backup file format');return}
      showConfirm(`This will REPLACE all tasks in the current project with the imported backup (${data.tasks.length} tasks). Continue?`,async()=>{
        setSS('⟳ Importing...');showL()
        try{
          // 1. Delete existing data
          await db.from('dependencies').delete().eq('project_id',state.currentProjectId)
          await db.from('tasks').delete().eq('project_id',state.currentProjectId)
          // 2. Smart ID remapping — new UUIDs prevent PK collisions on import to any project
          const idMap={}
          data.tasks.forEach(t=>{idMap[t.id]=crypto.randomUUID()})
          const newTasks=data.tasks.map(t=>{
            const nt={...t,project_id:state.currentProjectId,id:idMap[t.id]}
            nt.parent_id=(nt.parent_id&&idMap[nt.parent_id])||null
            return nt
          })
          const newDeps=(data.deps||[]).map(d=>({
            ...d,
            project_id:state.currentProjectId,
            id:crypto.randomUUID(),
            from_task_id:idMap[d.from_task_id],
            to_task_id:idMap[d.to_task_id]
          })).filter(d=>d.from_task_id&&d.to_task_id)
          // 3. Bulk insert
          if(newTasks.length){const{error:tErr}=await db.from('tasks').insert(newTasks);if(tErr)throw tErr}
          if(newDeps.length){const{error:dErr}=await db.from('dependencies').insert(newDeps);if(dErr)throw dErr}
          // 4. Reload state
          await loadTasks();await loadDeps();render()
          setSS('✓ Synced')
          toast(`✅ Successfully restored ${newTasks.length} tasks`)
        }catch(dbErr){
          toast('❌ Database Error: '+dbErr.message);setSS('✗ Error')
        }finally{hideL()}
      })
    }catch(err){
      toast('❌ Failed to read JSON file: '+err.message)
    }finally{
      e.target.value=''
    }
  }
  reader.readAsText(file)
}

// === UI HELPERS ===
function setSS(t){
  document.getElementById('sync-status').textContent=t
}
let _toastTimer=null
function toast(msg,dur=2500){
  const el=document.getElementById('toast')
  clearTimeout(_toastTimer)
  el.textContent=msg
  el.classList.add('show')
  _toastTimer=setTimeout(()=>el.classList.remove('show'),dur)
}
function showL(){document.getElementById('loading').style.display='flex'}
function hideL(){document.getElementById('loading').style.display='none'}
function markDirty(){setSS('● Unsaved changes')}
function fmtTime(d){return d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}
function rememberFocus(){
  lastFocusEl=document.activeElement
  focusStack.push(lastFocusEl)
}
function restoreFocus(){
  const el=focusStack.pop()||lastFocusEl
  if(el&&typeof el.focus==='function'&&document.contains(el))el.focus()
  lastFocusEl=focusStack[focusStack.length-1]||null
}
const FOCUSABLE_SEL='a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'
const modalStack=[]
function getDialogFromBackdrop(backdrop){
  return backdrop?.querySelector('[role="dialog"],.modal-content')
}
function openModalBackdrop(id,focusSelector){
  const backdrop=document.getElementById(id)
  if(!backdrop)return
  if(!backdrop.classList.contains('show'))rememberFocus()
  backdrop.classList.add('show')
  backdrop.setAttribute('aria-hidden','false')
  const existingIdx=modalStack.indexOf(id)
  if(existingIdx>=0)modalStack.splice(existingIdx,1)
  modalStack.push(id)
  const dialog=getDialogFromBackdrop(backdrop)
  if(dialog&&!dialog.hasAttribute('tabindex'))dialog.tabIndex=-1
  setTimeout(()=>{
    const target=focusSelector?backdrop.querySelector(focusSelector):null
    ;(target||backdrop.querySelector(FOCUSABLE_SEL)||dialog)?.focus?.()
  },0)
}
function closeModalBackdrop(id,{restore=true}={}){
  const backdrop=document.getElementById(id)
  if(!backdrop)return
  const wasOpen=backdrop.classList.contains('show')||modalStack.includes(id)
  backdrop.classList.remove('show')
  backdrop.setAttribute('aria-hidden','true')
  const idx=modalStack.lastIndexOf(id)
  if(idx>=0)modalStack.splice(idx,1)
  if(restore&&wasOpen)restoreFocus()
}
function getTopModalBackdrop(){
  for(let i=modalStack.length-1;i>=0;i--){
    const el=document.getElementById(modalStack[i])
    if(el?.classList.contains('show'))return el
  }
  return null
}
function trapFocusIn(backdrop,e){
  if(e.key!=='Tab')return false
  const focusables=[...backdrop.querySelectorAll(FOCUSABLE_SEL)].filter(el=>el.offsetParent!==null)
  if(!focusables.length)return false
  const first=focusables[0],last=focusables[focusables.length-1]
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();return true}
  if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();return true}
  return false
}
function closeTopModal(){
  const top=getTopModalBackdrop()
  if(!top)return false
  const id=top.id
  if(id==='task-modal-bd')closeTaskModal()
  else if(id==='proj-modal-bd')closeProjModal()
  else if(id==='confirm-modal-bd')closeConfirmModal()
  else if(id==='settings-modal-bd')closeSettings()
  else if(id==='dep-unified-modal-bd')closeDependencyModal()
  else closeModalBackdrop(id)
  return true
}

function applyGanttSettings(){
  const right=document.getElementById('right')
  if(right)right.classList.toggle('hide-gtxt',!state.settings.showTextOnBars)
}

document.getElementById('sw-gtxt').addEventListener('change',function(){
  state.settings.showTextOnBars=this.checked
  applyGanttSettings()
})

// === COLUMN RESIZE ===
function applyColumnWidths(){
  // Single CSS-variable write propagates to every .trow and #col-hdr simultaneously
  // via var(--col-grid) — no per-row DOM loop needed.
  const tpl=state.colWidths.map(w=>w+'px').join(' ')
  document.documentElement.style.setProperty('--col-grid',tpl)
  // Clear any stale inline override on the header (inline beats CSS vars)
  const hdr=document.getElementById('col-hdr')
  if(hdr)hdr.style.gridTemplateColumns=''
}

function renderColHdr(){
  const hdr=document.getElementById('col-hdr')
  if(!hdr)return
  const visible=getFilteredVisible()
  const allSel=visible.length>0&&visible.every(({task})=>selectedTaskIds.has(task.id))
  const someSel=selectedTaskIds.size>0&&!allSel
  const cols=[
    {lbl:`<span class="hdr-hash">#</span><input type="checkbox" id="hdr-select-all" class="hdr-chk"${allSel?' checked':''} title="Select all">`,align:'center',raw:true},
    {lbl:'',align:'center'},{lbl:'Task Name',align:'left'},
    {lbl:'Start',align:'center'},{lbl:'End',align:'center'},{lbl:'Assignee',align:'center'},
    {lbl:'Days',align:'center'},{lbl:'%',align:'center'},{lbl:'Status',align:'center'},
    {lbl:'Category',align:'center'},{lbl:'Actions',align:'center'}
  ]
  hdr.innerHTML=cols.map((c,i)=>`<div style="position:relative;text-align:${c.align};${c.align==='left'?'padding-left:4px':''}">${c.lbl}<div class="resizer" data-col="${i}"></div></div>`).join('')
  const selAll=hdr.querySelector('#hdr-select-all')
  if(selAll){
    selAll.indeterminate=someSel
    selAll.onclick=e=>{e.stopPropagation();selAll.checked?selectAll():deselectAll()}
  }
  hdr.querySelectorAll('.resizer').forEach(el=>el.addEventListener('mousedown',onColResizerDown))
}

function onColResizerDown(e){
  e.preventDefault()
  colResize.active=true
  colResize.colIdx=parseInt(e.currentTarget.dataset.col)
  colResize.startX=e.clientX
  colResize.startW=state.colWidths[colResize.colIdx]
  e.currentTarget.classList.add('is-resizing')
  document.body.style.cursor='col-resize'
  document.body.style.userSelect='none'
}

document.addEventListener('mouseup',()=>{
  if(!colResize.active)return
  colResize.active=false
  document.body.style.cursor=''
  document.body.style.userSelect=''
  document.querySelectorAll('.resizer.is-resizing').forEach(el=>el.classList.remove('is-resizing'))
})

document.getElementById('col-hdr').addEventListener('dblclick',e=>{
  const resizer=e.target.closest('.resizer')
  if(!resizer)return
  const colIdx=parseInt(resizer.dataset.col)
  let maxWidth=0
  document.querySelectorAll(`#col-hdr > *:nth-child(${colIdx+1}), .trow > *:nth-child(${colIdx+1})`).forEach(cell=>{
    const clone=cell.cloneNode(true)
    clone.style.cssText='position:absolute;visibility:hidden;width:auto;max-width:none;white-space:nowrap;overflow:visible;display:inline-block;z-index:-9999'
    clone.querySelectorAll('*').forEach(el=>{el.style.overflow='visible';el.style.maxWidth='none';el.style.width='auto'})
    document.body.appendChild(clone)
    maxWidth=Math.max(maxWidth,clone.getBoundingClientRect().width)
    clone.remove()
  })
  state.colWidths[colIdx]=Math.min(Math.max(maxWidth+12,40),600)
  applyColumnWidths()
})

// === PANEL SPLITTER — ghost + rAF throttle ===
// MouseMove only repositions a lightweight ghost line (no layout work).
// The real #left resize + applyColumnWidths run once on mouseup.
const panelResizer=document.getElementById('panel-resizer')
const leftPanel=document.getElementById('left')

// Ghost splitter: a fixed vertical line that follows the cursor during drag
const ghostSplitter=document.createElement('div')
ghostSplitter.id='ghost-splitter'
document.body.appendChild(ghostSplitter)

let isResizingPanel=false,startPanelX=0,startLeftWidth=0
let panelCurrentX=0,panelRafId=null

document.addEventListener('mousemove',e=>{
  if(colResize.active){
    const delta=e.clientX-colResize.startX
    state.colWidths[colResize.colIdx]=Math.max(20,colResize.startW+delta)
    if(!colRafId){
      colRafId=requestAnimationFrame(()=>{
        applyColumnWidths()
        colRafId=null
      })
    }
  }

  if(isResizingPanel){
    panelCurrentX=e.clientX
    if(!panelRafId){
      panelRafId=requestAnimationFrame(()=>{
        const ghost=document.getElementById('ghost-splitter')
        if(ghost)ghost.style.left=panelCurrentX+'px'
        panelRafId=null
      })
    }
  }

  if(isDraggingBar&&dragBarEl)handleBarDrag(e)
})

panelResizer.addEventListener('dblclick',()=>{
  if(typeof autoFitAll==='function')autoFitAll()
})

panelResizer.addEventListener('mousedown',e=>{
  e.preventDefault()
  isResizingPanel=true
  startPanelX=e.clientX
  panelCurrentX=e.clientX
  startLeftWidth=leftPanel.getBoundingClientRect().width
  panelResizer.classList.add('is-dragging')
  ghostSplitter.style.left=e.clientX+'px'
  ghostSplitter.classList.add('active')
  document.body.style.cursor='col-resize'
  document.body.style.userSelect='none'
  disableTransitions()
})

document.addEventListener('mouseup',()=>{
  if(!isResizingPanel)return
  isResizingPanel=false
  if(panelRafId){cancelAnimationFrame(panelRafId);panelRafId=null}
  ghostSplitter.classList.remove('active')
  panelResizer.classList.remove('is-dragging')
  document.body.style.cursor=''
  document.body.style.userSelect=''
  // Commit the resize once: set width + sync column grid
  const newW=Math.min(Math.max(startLeftWidth+(panelCurrentX-startPanelX),320),window.innerWidth*0.8)
  leftPanel.style.width=newW+'px'
  applyColumnWidths()
  enableTransitions()
})

document.getElementById('right').addEventListener('mousedown',e=>{
  if(isResizingPanel||colResize.active)return
  const bar=e.target.closest('.gbar')
  if(!bar||!bar.dataset.taskId)return
  const task=state.tasks.find(t=>t.id===bar.dataset.taskId)
  if(!task)return
  if(task.locked)return
  const hasKids = state.tasks.some(c => c.parent_id === task.id);
  if(hasKids) return;
  const rect=bar.getBoundingClientRect()
  const offsetX=e.clientX-rect.left
  const HANDLE=8
  if(offsetX<=HANDLE) dragMode='resize-left'
  else if(offsetX>=rect.width-HANDLE) dragMode='resize-right'
  else dragMode='move'
  isDraggingBar=true
  dragBarStartX=e.clientX
  dragBarOrigStart=task.start_date
  dragBarOrigDur=task.duration_days||1
  dragBarOrigLeft=bar.offsetLeft
  dragBarOrigWidth=bar.offsetWidth
  dragBarTaskId=task.id
  dragBarEl=bar
  // .is-dragging disables ALL CSS transitions so JS position updates are frame-perfect
  bar.classList.add('is-dragging')
  document.body.style.userSelect='none'
  document.body.style.cursor=dragMode==='move'?'grabbing':'ew-resize'
  e.preventDefault()
})

function handleBarDrag(e){
  const deltaX=e.clientX-dragBarStartX
  const DP=getPxPerDay()
  switch(dragMode){
    case 'move':
      // Direct left manipulation keeps the cursor locked to the grab point.
      // translateX was layered on top of the CSS `left`, causing a 1-frame
      // coordinate mismatch when transitions fired on mousedown.
      dragBarEl.style.left=(dragBarOrigLeft+deltaX)+'px'
      break
    case 'resize-right':
      dragBarEl.style.width=Math.max(DP,dragBarOrigWidth+deltaX)+'px'
      break
    case 'resize-left':{
      const clamped=Math.min(deltaX,dragBarOrigWidth-DP)
      dragBarEl.style.left=(dragBarOrigLeft+clamped)+'px'
      dragBarEl.style.width=Math.max(DP,dragBarOrigWidth-clamped)+'px'
      break
    }
  }
}

document.addEventListener('mouseup',async e=>{
  if(!isDraggingBar)return
  const deltaX=e.clientX-dragBarStartX
  const DP=getPxPerDay()
  const savedMode=dragMode
  isDraggingBar=false
  dragMode=null
  document.body.style.userSelect=''
  document.body.style.cursor=''
  if(dragBarEl){
    dragBarEl.classList.remove('is-dragging')
    dragBarEl.style.transform=''   // guard against any residual transform
    // Snap back to original position — render() will redraw at the correct new date
    dragBarEl.style.left=dragBarOrigLeft+'px'
    dragBarEl.style.width=dragBarOrigWidth+'px'
  }

  if(Math.abs(deltaX)<5){dragBarEl=null;dragBarTaskId=null;dragBarOrigStart=null;return}

  barWasDragged=true
  const task=state.tasks.find(t=>t.id===dragBarTaskId)
  if(!task){dragBarEl=null;dragBarTaskId=null;dragBarOrigStart=null;return}

  const deltaDays=Math.round(deltaX/DP)
  if(deltaDays===0){barWasDragged=false;dragBarEl=null;dragBarTaskId=null;dragBarOrigStart=null;return}

  const prevStart=task.start_date,prevDur=task.duration_days
  let newStart=prevStart,newDur=prevDur

  switch(savedMode){
    case 'move':{
      const d=new Date(pd(dragBarOrigStart))
      d.setDate(d.getDate()+deltaDays)
      newStart=fmtISO(d)
      newDur=dragBarOrigDur
      break
    }
    case 'resize-right':
      newStart=dragBarOrigStart
      newDur=Math.max(1,dragBarOrigDur+deltaDays)
      break
    case 'resize-left':{
      const d=new Date(pd(dragBarOrigStart))
      d.setDate(d.getDate()+deltaDays)
      newStart=fmtISO(d)
      newDur=Math.max(1,dragBarOrigDur-deltaDays)
      break
    }
  }

  const prevSnapshot=new Map()
  state.tasks.forEach(t=>prevSnapshot.set(t.id,{start_date:t.start_date,duration_days:t.duration_days}))

  task.start_date=newStart
  task.duration_days=newDur

  setSS('⟳ Saving...')
  const{error}=await db.from('tasks').update({start_date:newStart,duration_days:newDur}).eq('id',task.id)
  if(error){
    toast('❌ Failed to save: '+error.message)
    task.start_date=prevStart
    task.duration_days=prevDur
    setSS('✗ Error')
    render()
  } else {
    try{
      const changedMap=cascadeDates(task.id)
      await persistCascadedTasks(changedMap)
      const label=savedMode==='move'?'moved':savedMode==='resize-right'?'end updated':'start updated'
      setSS('✓ Synced')
      toast(`✅ Task ${label}`)
      render()
    }catch(err){
      prevSnapshot.forEach((v,id)=>{const t=state.tasks.find(x=>x.id===id);if(t){t.start_date=v.start_date;t.duration_days=v.duration_days}})
      await loadTasks()
      setSS('✗ Error')
      toast('❌ Cascade save failed: '+err.message)
      render()
    }
  }

  dragBarEl=null;dragBarTaskId=null;dragBarOrigStart=null
})

// === EVENT LISTENERS ===
window.addEventListener('blur',()=>{
  if(isResizingPanel){
    isResizingPanel=false
    if(panelRafId){cancelAnimationFrame(panelRafId);panelRafId=null}
    const ghost=document.getElementById('ghost-splitter')
    if(ghost)ghost.classList.remove('active')
    document.getElementById('panel-resizer')?.classList.remove('is-dragging')
    document.body.style.cursor='';document.body.style.userSelect=''
    enableTransitions()
  }
  if(isDraggingBar){
    isDraggingBar=false
    dragBarEl?.classList.remove('is-dragging')
    dragBarEl=null;dragBarTaskId=null;dragBarOrigStart=null
    document.body.style.cursor='';document.body.style.userSelect=''
  }
  if(colResize.active){
    colResize.active=false
    document.querySelectorAll('.resizer.is-resizing').forEach(el=>el.classList.remove('is-resizing'))
    document.body.style.cursor='';document.body.style.userSelect=''
  }
})

document.getElementById('task-modal-bd').onclick=e=>{if(e.target===e.currentTarget)closeTaskModal()}
document.getElementById('proj-modal-bd').onclick=e=>{if(e.target===e.currentTarget)closeProjModal()}
document.getElementById('confirm-modal-bd').onclick=e=>{if(e.target===e.currentTarget)closeConfirmModal()}
document.getElementById('settings-modal-bd').onclick=e=>{if(e.target===e.currentTarget)closeSettings()}
document.getElementById('dep-unified-modal-bd').onclick=e=>{if(e.target===e.currentTarget)closeDependencyModal()}

document.getElementById('confirm-btn').addEventListener('click',()=>{
  if(confirmCallback)confirmCallback()
  closeConfirmModal()
})

document.addEventListener('keydown',e=>{
  const topModal=getTopModalBackdrop()
  if(topModal&&trapFocusIn(topModal,e))return
  const isTyping=['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)||e.target.isContentEditable
  if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&e.key.toLowerCase()==='z'){e.preventDefault();if(!isTyping)undo();return}
  if((e.ctrlKey||e.metaKey)&&(e.key.toLowerCase()==='y'||(e.shiftKey&&e.key.toLowerCase()==='z'))){e.preventDefault();if(!isTyping)redo();return}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){
    e.preventDefault()
    const s=document.getElementById('search-box');if(s){s.focus();s.select()}
  }
  if(!isTyping&&e.key.toLowerCase()==='n'&&!e.ctrlKey&&!e.metaKey){
    e.preventDefault();openAddModal()
  }
  if(e.key==='n'&&(e.metaKey||e.ctrlKey)){
    e.preventDefault();openAddModal()
  }
  if(e.key==='Escape'){
    if(ctxMenu&&!ctxMenu.classList.contains('hidden')){hideTaskContextMenu();return}
    if(closeTopModal())return
    if(_detailPanelId){closeDetailPanel();return}
    if(selectedTaskIds.size>0){deselectAll();return}
    ;['holiday-modal','custom-prompt-overlay'].forEach(id=>{
      const m=document.getElementById(id)
      if(m&&m.classList.contains('show')){m.classList.remove('show');m.classList.add('hidden')}
    })
  }
  if(!isTyping&&(e.key==='Delete'||e.key==='Backspace')){
    if(selectedTaskIds.size>0){e.preventDefault();bulkDelete();return}
    const focused=document.activeElement?.closest('.trow')
    if(focused&&state.currentView==='gantt'){e.preventDefault();confirmDelete(focused.dataset.id)}
  }
  if(!isTyping&&(e.key==='ArrowDown'||e.key==='ArrowUp')){
    e.preventDefault()
    const rows=[...document.querySelectorAll('#task-list .trow')]
    if(!rows.length)return
    const idx=rows.indexOf(document.activeElement?.closest('.trow'))
    const next=e.key==='ArrowDown'?rows[Math.min(idx+1,rows.length-1)]:rows[Math.max(idx-1,0)]
    if(next)next.focus()
  }
  if(!isTyping&&(e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='a'&&state.currentView==='gantt'){
    e.preventDefault();selectAll()
  }
})

document.addEventListener('mouseover',e=>{
  const target=e.target.closest('[data-task-id]');if(!target)return
  const id=target.dataset.taskId
  document.querySelectorAll(`[data-task-id="${id}"]`).forEach(el=>el.classList.add('hover-sync'))
})
document.addEventListener('mouseout',e=>{
  const target=e.target.closest('[data-task-id]');if(!target)return
  const id=target.dataset.taskId
  document.querySelectorAll(`[data-task-id="${id}"]`).forEach(el=>el.classList.remove('hover-sync'))
})

let currentContextMenuTaskId=null
const ctxMenu=document.getElementById('task-context-menu')
function hideTaskContextMenu({restore=false}={}){
  if(!ctxMenu)return
  ctxMenu.classList.add('hidden')
  ctxMenu.setAttribute('aria-hidden','true')
  currentContextMenuTaskId=null
  if(restore)restoreFocus()
}
function showTaskContextMenu(taskId,x,y){
  if(!ctxMenu)return
  currentContextMenuTaskId=taskId
  rememberFocus()
  ctxMenu.classList.remove('hidden')
  ctxMenu.setAttribute('aria-hidden','false')
  const rect=ctxMenu.getBoundingClientRect()
  const left=Math.min(Math.max(8,x),window.scrollX+window.innerWidth-rect.width-8)
  const top=Math.min(Math.max(8,y),window.scrollY+window.innerHeight-rect.height-8)
  ctxMenu.style.left=left+'px'
  ctxMenu.style.top=top+'px'
  ctxMenu.querySelector('[role="menuitem"],button')?.focus()
}

document.addEventListener('contextmenu',e=>{
  const target=e.target.closest('[data-task-id]')
  if(!target){hideTaskContextMenu();return}
  e.preventDefault()
  showTaskContextMenu(target.dataset.taskId,e.pageX,e.pageY)
})
document.addEventListener('click',e=>{
  if(ctxMenu&&!ctxMenu.contains(e.target))hideTaskContextMenu()
})
ctxMenu?.addEventListener('keydown',e=>{
  const items=[...ctxMenu.querySelectorAll('[role="menuitem"],button')]
  const idx=items.indexOf(document.activeElement)
  if(e.key==='Escape'){e.preventDefault();hideTaskContextMenu({restore:true})}
  if(e.key==='ArrowDown'){e.preventDefault();items[(idx+1+items.length)%items.length]?.focus()}
  if(e.key==='ArrowUp'){e.preventDefault();items[(idx-1+items.length)%items.length]?.focus()}
})
document.getElementById('ctx-edit')?.addEventListener('click',()=>{
  const taskId=currentContextMenuTaskId
  hideTaskContextMenu()
  if(taskId)openEditModal(taskId)
})
document.getElementById('ctx-delete')?.addEventListener('click',()=>{
  const taskId=currentContextMenuTaskId
  hideTaskContextMenu()
  if(taskId)confirmDelete(taskId)
})

;['t-name','t-parent','t-type','t-category','t-start','t-duration','t-assignee','t-progress-num','f-delayed','f-onhold','f-cancelled','t-locked'].forEach(id=>{
  const el=document.getElementById(id)
  if(el){
    el.addEventListener('input',markDirty)
    el.addEventListener('change',markDirty)
  }
})

document.getElementById('t-type').addEventListener('change',()=>applyTaskModalGuards(state.editingTaskId))

let rt
window.addEventListener('resize',()=>{clearTimeout(rt);rt=setTimeout(()=>render(),200)})

// Collapse sidebar submenu whenever the sidebar itself collapses
document.getElementById('app-sidebar').addEventListener('mouseleave', () => {
  const submenu = document.getElementById('projects-submenu');
  const header = document.querySelector('.sidebar-item.has-submenu');
  if (submenu && submenu.classList.contains('expanded')) {
    submenu.classList.remove('expanded');
    if (header) header.classList.remove('open');
  }
});

// === INIT ===
async function init(){
  loadSettings();showL()
  try{
    await ensureAuth()
    await Promise.all([loadProjects(),loadHolidays()])
    initSS();applyGanttSettings();render();populateCategoryDropdowns()
    triggerAutoFitOnNextPaint()
    if(state.projects.length===1)selectProject(state.projects[0].id)
    else if(state.projects.length>1)openProjModal()
  }catch(err){
    console.error('Init failed:',err)
    toast('❌ Initialization Failed. Please refresh or check connection.')
  }finally{
    hideL()
  }
}
init()
