import { useEffect, useRef, useState } from 'preact/hooks';
import data from '../data/study.json';
import { emptyProgress, loadProgress, localDay, normalizeAnswer, saveProgress, scheduleRecall, type StudyLesson, type StudyProgress } from '../lib/study';
import { downloadAudio, isDownloaded } from '../lib/offline';
import { MicRecorder } from '../lib/recorder';

const lessons = data as StudyLesson[];
type View = 'home'|'library'|'review'|'profile'|'lesson';
type Mode = 'listen'|'speak'|'read'|'write';
const skills: {id:Mode; name:string; sub:string; icon:string}[] = [
  {id:'listen', name:'Nghe', sub:'Nghe kỹ, nhớ lâu', icon:'headphones'},
  {id:'speak', name:'Nói', sub:'Thu âm & nghe lại', icon:'mic'},
  {id:'read', name:'Đọc', sub:'Hiểu trong ngữ cảnh', icon:'book'},
  {id:'write', name:'Viết', sub:'Nghe & chép chính tả', icon:'pen'},
];
const categories = [['all','Tất cả'],['electrical','Ngành điện'],['everyday','Đời sống'],['b2b','Kinh doanh'],['vet','Thú y'],['derm','Da liễu']];
const audioUrls = lessons.flatMap(l=>l.items.map(i=>i.audio!).filter(Boolean));

export function Icon({name,size=22}:{name:string;size?:number}) {
  const paths:Record<string,any> = {
    headphones:<><path d="M3 14v-3a9 9 0 0 1 18 0v3"/><rect x="3" y="12" width="4" height="8" rx="2"/><rect x="17" y="12" width="4" height="8" rx="2"/></>,
    mic:<><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></>,
    book:<><path d="M12 5C8 2 4 3 2 4v15c4-2 7-1 10 1 3-2 6-3 10-1V4c-4-2-7-1-10 1v15"/></>,
    pen:<><path d="m15 4 5 5M4 20l5-1L21 7a3.5 3.5 0 0 0-5-5L4 14l-1 7 6-2"/></>,
    arrow:<path d="M4 12h16m-6-6 6 6-6 6"/>,
    download:<><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></>,
    home:<><path d="m3 10 9-7 9 7v11h-6v-7H9v7H3z"/></>,
    grid:<><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
    repeat:<><path d="m17 2 4 4-4 4M3 11V8a2 2 0 0 1 2-2h16M7 22l-4-4 4-4m14-1v3a2 2 0 0 1-2 2H3"/></>,
    user:<><circle cx="12" cy="8" r="4"/><path d="M4 22v-2a8 8 0 0 1 16 0v2"/></>,
    bolt:<path d="m13 2-9 12h7l-1 8 10-12h-7z"/>,
    check:<path d="m5 12 4 4L19 6"/>,
    close:<path d="m6 6 12 12M6 18 18 6"/>,
    play:<path d="m8 4 12 8-12 8z"/>,
    pause:<><path d="M8 4v16M16 4v16"/></>,
    wifi:<><path d="M2 8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0M8 16a6 6 0 0 1 8 0"/><circle cx="12" cy="20" r="1"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{paths[name] || paths.book}</svg>;
}
function Wave({large=false}:{large?:boolean}) {
  return <div class={`wave-mark ${large?'wave-large':''}`} aria-hidden="true">{[18,32,48,28,60,40,24,48,68,36,52,24,42,20].map((h,i)=><span key={i} style={{height:`${large?h:h/3}px`}} />)}</div>;
}
export default function StudyApp() {
  const [ready,setReady]=useState(false);
  const [view,setView]=useState<View>('home');
  const [lesson,setLesson]=useState<StudyLesson>(lessons[0]);
  const [mode,setMode]=useState<Mode>('listen');
  const [category,setCategory]=useState('all');
  const [query,setQuery]=useState('');
  const [progress,setProgress]=useState<StudyProgress>(emptyProgress);
  const [online,setOnline]=useState(true);
  const [notice,setNotice]=useState('');
  const [download,setDownload]=useState<{done:number;total:number}|null>(null);
  const [downloaded,setDownloaded]=useState(false);
  const [install,setInstall]=useState<any>(null);
  const abort=useRef<AbortController|null>(null);
  const noticeTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const restore=(p:URLSearchParams)=>{
    const v=p.get('view');
    setView(['home','library','review','profile','lesson'].includes(v||'')?v as View:'home');
    setLesson(lessons.find(l=>l.id===p.get('id'))||lessons[0]);
    setMode(skills.some(s=>s.id===p.get('mode'))?p.get('mode') as Mode:'listen');
  };
  useEffect(()=>{
    setReady(true);
    setProgress(loadProgress()); setOnline(navigator.onLine);
    restore(new URLSearchParams(location.search));
    const pop=()=>restore(new URLSearchParams(location.search));
    const status=()=>setOnline(navigator.onLine);
    const prompt=(e:Event)=>{e.preventDefault();setInstall(e);};
    const storage=()=>setProgress(loadProgress());
    const refresh=setInterval(storage,30000);
    window.addEventListener('popstate',pop);window.addEventListener('online',status);window.addEventListener('offline',status);window.addEventListener('storage',storage);window.addEventListener('beforeinstallprompt',prompt);
    void isDownloaded(audioUrls).then(setDownloaded).catch(()=>{});
    return ()=>{clearInterval(refresh);window.removeEventListener('popstate',pop);window.removeEventListener('online',status);window.removeEventListener('offline',status);window.removeEventListener('storage',storage);window.removeEventListener('beforeinstallprompt',prompt);abort.current?.abort();clearTimeout(noticeTimer.current);};
  },[]);
  function toast(s:string){setNotice(s);clearTimeout(noticeTimer.current);noticeTimer.current=setTimeout(()=>setNotice(''),6500);}
  function persist(p:StudyProgress){setProgress(p);if(!saveProgress(p))toast('Trình duyệt chưa cho lưu tiến độ. Hãy bật lưu trữ cho trang này.');}
  function navigate(v:View,l=lesson,m=mode){
    setView(v);setLesson(l);setMode(m);
    const p=new URLSearchParams({view:v});if(v==='lesson'){p.set('id',l.id);p.set('mode',m);}
    history.pushState(null,'',v==='home'?'/':`/?${p}`);window.scrollTo({top:0,behavior:'instant'});
  }
  function finish(l:StudyLesson,m:Mode,latest=progress){
    const key=`${l.id}:${m}`;
    const day=localDay();
    persist({...latest,completed:[...new Set([...latest.completed,key])],days:[...new Set([...latest.days,day])],last:l.id});
  }
  async function downloadAll(){
    if(download){abort.current?.abort();return;}
    abort.current=new AbortController();setDownload({done:0,total:audioUrls.length});
    try{await downloadAudio(audioUrls,(done,total)=>setDownload({done,total}),abort.current.signal);setDownloaded(true);toast('Đã tải đủ bài nghe. Bạn có thể tắt mạng và học tiếp.');}
    catch(e){toast((e as Error).name==='AbortError'?'Đã dừng tải. Bấm tải lại để tiếp tục phần còn thiếu.':(e as Error).message);}
    finally{setDownload(null);}
  }
  const due=lessons.flatMap(l=>l.items.map((item,i)=>({lesson:l,item,key:`${l.id}:${i}`}))).filter(x=>progress.recalls[x.key]&&progress.recalls[x.key].due<=Date.now());
  const next=lessons.find(l=>!progress.completed.includes(`${l.id}:listen`))||lessons[0];
  const last=lessons.find(l=>l.id===progress.last)||next;
  const selectedLessons=lessons.filter(l=>(category==='all'||l.category===category)&&`${l.title} ${l.items.map(i=>i.en).join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  const navItems:{view:View;label:string;icon:string}[]=[{view:'home',label:'Hôm nay',icon:'home'},{view:'library',label:'Bài học',icon:'grid'},{view:'review',label:'Ôn tập',icon:'repeat'},{view:'profile',label:'Cá nhân',icon:'user'}];
  return <fieldset class="study-guard" disabled={!ready} aria-busy={!ready}><div class="study-app">
    <aside class="study-sidebar"><a class="brand" href="/" onClick={e=>{e.preventDefault();navigate('home');}}><span class="brand-symbol"><Wave/></span><span>English<br/><b>Voice Coach</b></span></a><span class="sidebar-caption">HỌC MỘT CHÚT, MỖI NGÀY</span><nav aria-label="Điều hướng chính">{navItems.map(n=><button class={view===n.view?'side-link active':'side-link'} onClick={()=>navigate(n.view)}><Icon name={n.icon}/>{n.label}{n.view==='review'&&due.length>0&&<span class="count-badge">{due.length}</span>}</button>)}</nav><div class="sidebar-bottom"><span class="free-label">Miễn phí cho mọi người</span><p>Kiến thức đi cùng bạn.<br/>Kể cả khi không có mạng.</p><a href="https://github.com/duytruongphat99999-sudo/english-voice-coach" target="_blank" rel="noreferrer">Mã nguồn mở ↗</a></div></aside>
    <div class="study-main"><header class="study-header"><a class="mobile-brand" href="/" onClick={e=>{e.preventDefault();navigate('home');}}><span class="brand-symbol"><Wave/></span><b>English Voice Coach</b></a><span class="desktop-crumb">Không gian học tiếng Anh <span>/ {navItems.find(n=>n.view===view)?.label||lesson.title}</span></span><span class={`connection ${online?'':'offline'}`}><span/>{online?'Sẵn sàng học':'Đang offline'}</span></header>
      <main id="study-content" class="study-content">
      {view==='home'&&<>
        <section class="welcome"><div><span class="eyebrow">MỘT THÓI QUEN NHỎ. MỘT BƯỚC TIẾN LỚN.</span><h1>Mỗi ngày một chút.<br/><span>Tiếng Anh tiến xa.</span></h1><p>Nghe, nói, đọc, viết. Bắt đầu từ 5 phút hôm nay.</p></div><span class="free-label welcome-label">Miễn phí · Không cần tài khoản</span></section>
        <div class="home-grid"><section class="daily-card"><div class="card-topline"><span class="pill">BÀI TẬP HÔM NAY</span><span>~ 5 phút</span></div><div class="daily-body"><div><h2>{next.title}</h2><p>5 câu thực tế. Nghe hiểu rồi tự nói lại.</p></div><Wave large/></div><button class="primary lime" onClick={()=>navigate('lesson',next,'listen')}>Bắt đầu 5 phút <Icon name="arrow"/></button><div class="daily-foot"><span>{progress.completed.length} lượt học đã hoàn thành</span><span>{progress.days.length} ngày đã học</span></div></section>
        <section class="skills-section"><div class="section-title"><h2>Luyện theo cách của bạn</h2><span>4 kỹ năng</span></div><div class="skills-grid">{skills.map(s=><button class={`skill-card skill-${s.id}`} onClick={()=>navigate('lesson',last,s.id)}><span class="skill-icon"><Icon name={s.icon}/></span><strong>{s.name}</strong><span>{s.sub}</span><span class="skill-arrow">↗</span></button>)}</div></section></div>
        <section class="electrical-card"><div class="circuit-art" aria-hidden="true"><svg viewBox="0 0 140 140" fill="none"><path d="M10 40h35v30h50v30h35M10 100h30V20h60v30h30M70 10v30m0 60v30" stroke="currentColor" stroke-width="2"/>{[[10,40],[130,100],[10,100],[130,50],[70,10],[70,130]].map(([x,y])=><circle cx={x} cy={y} r="5" fill="currentColor"/>)}<rect x="48" y="48" width="44" height="44" rx="12" fill="var(--study-lime)"/><path d="m75 54-16 19h12l-5 13 17-20H71z" fill="var(--study-green)"/></svg></div><div><span class="eyebrow">TIẾNG ANH TRONG CÔNG VIỆC</span><h2>Nối mạch kiến thức.<br/>Vững tiếng Anh ngành điện.</h2><p>6 chủ đề · 30 câu nghe · Từ cơ bản đến bàn giao</p><button class="text-link" onClick={()=>{setCategory('electrical');navigate('library');}}>Khám phá ngành điện <Icon name="arrow" size={18}/></button></div><span class="course-tag">A2 → B1</span></section>
        <div class="section-title"><h2>Học một chủ đề mới</h2><button class="text-link" onClick={()=>{setCategory('all');navigate('library');}}>Tất cả bài học <Icon name="arrow" size={17}/></button></div><div class="topic-grid">{lessons.filter(l=>l.category==='everyday').slice(0,3).map(l=><TopicCard lesson={l} completed={progress.completed} open={()=>navigate('lesson',l,'listen')}/>)}</div>
        <section class="offline-card"><span class="offline-icon"><Icon name="download" size={26}/></span><div><h2>Mang bài học đi cùng bạn</h2><p>{downloaded?'Đã tải đủ 130 câu nghe. Sẵn sàng học offline.':'Tải bài nghe một lần, học tiếp khi mất mạng.'}</p></div><button class="secondary" onClick={()=>void downloadAll()} disabled={downloaded}>{download?`Dừng tải · ${Math.round(download.done/download.total*100)}%`:downloaded?'Đã tải đủ ✓':'Tải để học offline'}</button></section>
        <p class="quiet-note">Tiến độ lưu trên thiết bị này. Không quảng cáo. Không cần đăng ký.</p>
      </>}
      {view==='library'&&<><span class="eyebrow">CHỌN ĐIỀU BẠN MUỐN HỌC</span><h1 class="page-title">Thư viện bài học</h1><p class="page-sub">26 chủ đề thực tế. Mỗi chủ đề đủ cả nghe, nói, đọc, viết.</p><label class="search-label">Tìm chủ đề hoặc câu tiếng Anh<input type="search" placeholder="Thử tìm: điện, công việc, voltage…" value={query} onInput={e=>setQuery(e.currentTarget.value)}/></label><div class="filter-row" aria-label="Lọc chủ đề">{categories.map(([id,name])=><button aria-pressed={category===id} class={category===id?'filter active':'filter'} onClick={()=>setCategory(id)}>{name}</button>)}</div><p class="results-count">{selectedLessons.length} chủ đề</p><div class="topic-grid library-grid">{selectedLessons.map(l=><TopicCard lesson={l} completed={progress.completed} open={()=>navigate('lesson',l,'listen')}/>)}</div>{!selectedLessons.length&&<div class="empty-state"><Icon name="book" size={36}/><h2>Chưa tìm thấy chủ đề</h2><p>Thử một từ ngắn hơn hoặc chọn “Tất cả”.</p><button class="secondary" onClick={()=>{setQuery('');setCategory('all');}}>Xem tất cả</button></div>}</>}
      {view==='lesson'&&<LessonPlayer key={`${lesson.id}:${mode}`} lesson={lesson} mode={mode} setMode={m=>navigate('lesson',lesson,m)} finish={latest=>finish(lesson,mode,latest)} back={()=>navigate('library')} progress={progress} persist={persist} toast={toast}/>}
      {view==='review'&&<Review progress={progress} due={due} persist={persist} openLibrary={()=>navigate('library')}/>}
      {view==='profile'&&<><span class="eyebrow">NHỊP HỌC CỦA BẠN</span><h1 class="page-title">Mỗi bước đều được ghi nhớ.</h1><p class="page-sub">Tiến độ của riêng bạn, được lưu trên thiết bị này.</p><div class="stats-grid"><div><strong>{progress.completed.length}</strong><span>Lượt học hoàn thành</span></div><div><strong>{progress.days.length}</strong><span>Ngày đã học</span></div><div><strong>{Object.keys(progress.recalls).length}</strong><span>Câu đang ôn</span></div></div><section class="settings-card"><h2>Học không cần mạng</h2><p>Tải 130 câu nghe cùng nội dung của 26 chủ đề. Sau khi tải xong, mở lại app được cả khi offline. Trình duyệt có thể dọn dữ liệu nếu thiết bị thiếu bộ nhớ.</p><button class="primary" onClick={()=>void downloadAll()} disabled={downloaded}>{download?`Dừng tải · ${download.done}/${download.total}`:downloaded?'Đã tải đủ bài nghe ✓':'Tải toàn bộ bài nghe'}<Icon name="download"/></button>{download&&<progress value={download.done} max={download.total} aria-label="Tiến độ tải âm thanh"/>}</section><section class="settings-card"><h2>Thêm vào màn hình chính</h2><p>{install?'Cài app để mở nhanh và học toàn màn hình.':'Trên iPhone: Chia sẻ → Thêm vào Màn hình chính. Trên Android: menu trình duyệt → Cài đặt ứng dụng.'}</p>{install&&<button class="secondary" onClick={async()=>{await install.prompt();setInstall(null);}}>Cài ứng dụng</button>}</section><section class="settings-card"><h2>Giữ lại tiến độ của bạn</h2><p>Sao lưu thành tệp để chuyển sang điện thoại khác. Xóa dữ liệu trình duyệt sẽ xóa tiến độ chưa sao lưu. Bản ghi âm chỉ nằm trong phiên học và không tải lên máy chủ.</p><div class="button-row"><button class="secondary" onClick={()=>{const url=URL.createObjectURL(new Blob([JSON.stringify({version:1,progress},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`english-progress-${localDay()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>Xuất tiến độ</button><label class="secondary import-label">Nhập tiến độ<input type="file" accept="application/json" onChange={async e=>{const f=e.currentTarget.files?.[0];if(!f)return;try{if(f.size>1000000)throw new Error();const x=JSON.parse(await f.text());const p=x.progress;if(x.version!==1||!Array.isArray(p.completed)||!p.completed.every((v:unknown)=>typeof v==='string')||!Array.isArray(p.days)||!p.days.every((v:unknown)=>typeof v==='string')||!p.recalls||typeof p.recalls!=='object'||Object.values(p.recalls).some((r:any)=>!r||!Number.isFinite(r.due)||!Number.isFinite(r.interval)||!Number.isFinite(r.reviews)))throw new Error();persist(p);toast('Đã nhập tiến độ.');}catch{toast('Tệp tiến độ không hợp lệ. Hãy chọn tệp đã xuất từ app.');}e.currentTarget.value='';}}/></label></div></section><section class="settings-card"><h2>Huấn luyện cá nhân với AI</h2><p>Khu riêng có lịch sử, PTE, tiếng Pháp và chấm giọng nói. Cần mật khẩu của chủ hệ thống và kết nối mạng.</p><a class="text-link" href="/coach">Mở khu cá nhân <Icon name="arrow" size={18}/></a></section><p class="quiet-note">English Voice Coach · Miễn phí & mã nguồn mở.<br/>Nội dung ngành điện dùng để học ngôn ngữ, không thay thế đào tạo nghề.</p></>}
      </main><footer class="study-footer"><span>English Voice Coach</span><span>Học đều. Tự tin hơn mỗi ngày.</span></footer>
    </div><nav class="mobile-nav" aria-label="Điều hướng trên điện thoại">{navItems.map(n=><button aria-current={view===n.view?'page':undefined} class={view===n.view?'active':''} onClick={()=>navigate(n.view)}><Icon name={n.icon} size={21}/><span>{n.label}{n.view==='review'&&due.length>0?' •':''}</span></button>)}</nav>{notice&&<div class="study-toast" role="status">{notice}<button aria-label="Đóng thông báo" onClick={()=>setNotice('')}><Icon name="close" size={18}/></button></div>}
  </div></fieldset>;
}
function TopicCard({lesson:l,completed,open}:{lesson:StudyLesson;completed:string[];open:()=>void}) {
  const count=skills.filter(s=>completed.includes(`${l.id}:${s.id}`)).length;
  return <button class="topic-card" onClick={open}><div class="topic-top"><span class={`topic-icon ${l.category==='electrical'?'electric':''}`}><Icon name={l.category==='electrical'?'bolt':'book'}/></span><span class="level-tag">{l.level}</span></div><h3>{l.title}</h3><p>{l.items.length} câu · 4 kỹ năng</p><div class="topic-bottom"><span>{count?`${count}/4 kỹ năng hoàn thành`:'Bắt đầu chủ đề'}</span><Icon name={count===4?'check':'arrow'} size={18}/></div></button>;
}

function LessonPlayer({lesson:l,mode,setMode,finish,back,progress,persist,toast}:{lesson:StudyLesson;mode:Mode;setMode:(m:Mode)=>void;finish:(latest?:StudyProgress)=>void;back:()=>void;progress:StudyProgress;persist:(p:StudyProgress)=>void;toast:(s:string)=>void}) {
  const [index,setIndex]=useState(0),[revealed,setRevealed]=useState(false),[answer,setAnswer]=useState(''),[checked,setChecked]=useState(false),[complete,setComplete]=useState(false);
  const [recording,setRecording]=useState(false),[recordBusy,setRecordBusy]=useState(false),[recordUrl,setRecordUrl]=useState(''),[seconds,setSeconds]=useState(0);
  const [readAnswer,setReadAnswer]=useState('');
  const recorder=useRef<MicRecorder|null>(null),timer=useRef<ReturnType<typeof setInterval>|undefined>(undefined),recordUrlRef=useRef('');
  const item=l.items[index],key=`${l.id}:${index}`;
  const correct=normalizeAnswer(answer)===normalizeAnswer(item.en);
  useEffect(()=>()=>{recorder.current?.cancel();clearInterval(timer.current);if(recordUrlRef.current)URL.revokeObjectURL(recordUrlRef.current);},[]);
  useEffect(()=>{if(!recording)return;timer.current=setInterval(()=>setSeconds(s=>s+1),1000);return()=>clearInterval(timer.current);},[recording]);
  useEffect(()=>{if(seconds>=45&&recording)void record();},[seconds]);
  async function record(){
    if(recordBusy)return;setRecordBusy(true);
    try{
      if(recording){const result=await recorder.current!.stop();setRecording(false);if(recordUrlRef.current)URL.revokeObjectURL(recordUrlRef.current);recordUrlRef.current=URL.createObjectURL(result.blob);setRecordUrl(recordUrlRef.current);}
      else{window.dispatchEvent(new Event('evc-stop-audio'));recorder.current=new MicRecorder();await recorder.current.start();setSeconds(0);setRecordUrl('');setRecording(true);}
    }catch(e){setRecording(false);toast((e as Error).message);}finally{setRecordBusy(false);}
  }
  function next(){
    recorder.current?.cancel();setRecording(false);setSeconds(0);if(recordUrlRef.current){URL.revokeObjectURL(recordUrlRef.current);recordUrlRef.current='';}setRecordUrl('');
    if(index===l.items.length-1){finish();setComplete(true);}
    else{setIndex(index+1);setRevealed(false);setAnswer('');setChecked(false);setReadAnswer('');}
  }
  function recall(remembered:boolean){
    const updated={...progress,recalls:{...progress.recalls,[key]:scheduleRecall(progress.recalls[key],remembered)}};
    if(index===l.items.length-1){finish(updated);setComplete(true);}else{persist(updated);next();}
  }
  const readOptions=[item.vi,l.items[(index+1)%l.items.length].vi,l.items[(index+2)%l.items.length].vi].sort((a,b)=>a.localeCompare(b,'vi'));
  return <div class="lesson-shell"><button class="back-link" onClick={back}>← Thư viện bài học</button><div class="lesson-title"><div><span class="eyebrow">{l.category==='electrical'?'TIẾNG ANH NGÀNH ĐIỆN':'TIẾNG ANH THỰC TẾ'}</span><h1>{l.title}</h1></div><span class="level-tag">{l.level}</span></div><div class="mode-tabs" role="group" aria-label="Kỹ năng luyện tập">{skills.map(s=><button aria-pressed={mode===s.id} class={mode===s.id?'active':''} onClick={()=>setMode(s.id)}><Icon name={s.icon} size={18}/>{s.name}</button>)}</div>
    {complete?<section class="completion-card"><span class="completion-check"><Icon name="check" size={36}/></span><span class="eyebrow">THÊM MỘT BƯỚC TIẾN</span><h2>Bạn đã hoàn thành {l.items.length} câu!</h2><p>Thử một kỹ năng khác với cùng chủ đề để nhớ sâu hơn.</p><div class="button-row">{skills.filter(s=>s.id!==mode).map(s=><button class="secondary" onClick={()=>setMode(s.id)}><Icon name={s.icon} size={18}/>{s.name}</button>)}</div><button class="text-link" onClick={back}>Chọn chủ đề tiếp theo <Icon name="arrow" size={18}/></button></section>:<>
    <div class="lesson-progress"><span>Câu {index+1} / {l.items.length}</span><span>{skills.find(s=>s.id===mode)?.sub}</span></div><progress value={index} max={l.items.length} aria-label="Tiến độ bài học"/>
    <section class="exercise-card"><div class="exercise-eyebrow"><span>{mode==='listen'?'NGHE TRƯỚC, XEM CHỮ SAU':mode==='speak'?'NGHE MẪU, RỒI NÓI LẠI':mode==='read'?'ĐỌC VÀ CHỌN NGHĨA ĐÚNG':'NGHE VÀ VIẾT LẠI'}</span><span>{String(index+1).padStart(2,'0')}</span></div>
      {mode!=='read'&&<AudioPlayer key={item.audio} src={item.audio!} nextSrc={l.items[index+1]?.audio} toast={toast}/>}
      {(mode==='speak'||mode==='read'||revealed||(mode==='write'&&checked))&&<p class="english-sentence" lang="en">{item.en}</p>}
      {mode==='listen'&&<><p class="exercise-hint">Nghe 1–2 lần. Thử đoán ý chính trước khi mở câu.</p><button class="secondary wide" aria-expanded={revealed} onClick={()=>setRevealed(!revealed)}>{revealed?'Ẩn câu & bản dịch':'Hiện câu & bản dịch'}</button>{revealed&&<><p class="translation">{item.vi}</p><p class="focus-note">{item.focus}</p><p class="recall-label">Bạn nhớ câu này đến đâu?</p><div class="button-row"><button class="secondary" onClick={()=>recall(false)}>Cần ôn lại</button><button class="primary" onClick={()=>recall(true)}>Đã nhớ <Icon name="check" size={18}/></button></div></>}</>}
      {mode==='speak'&&<><p class="translation">{item.vi}</p><p class="focus-note">{item.focus}</p><button class={`record-button ${recording?'recording':''}`} disabled={recordBusy} onClick={()=>void record()}><Icon name={recording?'pause':'mic'} size={24}/>{recordBusy?'Đang mở mic…':recording?`Dừng thu · ${seconds}s`:'Thu âm câu của bạn'}</button><p class="exercise-hint">Tối đa 45 giây. Nghe lại và đối chiếu với mẫu; bản ghi không gửi lên máy chủ.</p>{recordUrl&&<div class="record-preview"><label>Bản thu của bạn</label><audio controls src={recordUrl} preload="metadata"/><button class="primary wide" onClick={next}>Đã nghe & so sánh <Icon name="arrow" size={18}/></button></div>}</>}
      {mode==='read'&&<><p class="exercise-hint">Câu trên có nghĩa là gì?</p><div class="read-options">{readOptions.map(option=><button disabled={!!readAnswer} class={readAnswer?(option===item.vi?'correct':option===readAnswer?'incorrect':''):''} onClick={()=>setReadAnswer(option)}>{option}</button>)}</div>{readAnswer&&<><p class={`answer-feedback ${readAnswer===item.vi?'correct':'incorrect'}`} role="status">{readAnswer===item.vi?'Đúng rồi.':`Chưa đúng. ${item.vi}`}</p><p class="focus-note">{item.focus}</p><button class="primary wide" onClick={next}>Câu tiếp theo <Icon name="arrow" size={18}/></button></>}</>}
      {mode==='write'&&<><label class="write-label" for="dictation">Viết câu tiếng Anh bạn nghe được</label><textarea id="dictation" lang="en" value={answer} rows={3} autoComplete="off" autoCorrect="off" spellcheck={false} disabled={checked} placeholder="Type what you hear…" onInput={e=>setAnswer(e.currentTarget.value)}/>{!checked?<button class="primary wide" disabled={!answer.trim()} onClick={()=>setChecked(true)}>Kiểm tra câu viết <Icon name="check" size={18}/></button>:<><p class={`answer-feedback ${correct?'correct':'incorrect'}`} role="status">{correct?'Chính xác! Bạn nghe và viết đúng câu.':'Chưa khớp. So sánh với câu mẫu ở trên rồi thử lại.'}</p><p class="translation">{item.vi}</p>{!correct&&<button class="secondary wide" onClick={()=>{setChecked(false);setRevealed(false);}}>Viết lại câu này</button>}<button class="primary wide" onClick={next}>{correct?'Câu tiếp theo':'Đã xem đáp án · Tiếp tục'} <Icon name="arrow" size={18}/></button></>}</>}
    </section><p class="quiet-note">{l.category==='electrical'?'Học ngôn ngữ chuyên ngành. Thao tác thực tế cần người có chuyên môn và quy trình được phê duyệt.':'Học chậm một câu, dùng được lâu hơn.'}</p></>}
  </div>;
}
function AudioPlayer({src,nextSrc,toast}:{src:string;nextSrc?:string;toast:(s:string)=>void}) {
  const ref=useRef<HTMLAudioElement|null>(null),preload=useRef<HTMLAudioElement|null>(null);
  const [state,setState]=useState('idle'),[speed,setSpeed]=useState(1),[time,setTime]=useState(0),[duration,setDuration]=useState(0);
  useEffect(()=>{
    const audio=ref.current;
    const stop=()=>{audio?.pause();setState('idle');};window.addEventListener('evc-stop-audio',stop);
    return()=>{window.removeEventListener('evc-stop-audio',stop);audio?.pause();preload.current?.pause();};
  },[]);
  async function play(){
    const a=ref.current;if(!a)return;
    if(!a.paused){a.pause();setState('idle');return;}
    window.dispatchEvent(new Event('evc-stop-audio'));setState('loading');
    try{a.playbackRate=speed;await a.play();if(nextSrc&&!(navigator as Navigator & {connection?:{saveData?:boolean}}).connection?.saveData){preload.current=new Audio(nextSrc);preload.current.preload='auto';}}
    catch{setState('error');toast('Không phát được. Hãy kiểm tra mạng hoặc tải bài nghe khi có mạng rồi thử lại.');}
  }
  const fmt=(n:number)=>`${Math.floor(n/60)}:${String(Math.floor(n%60)).padStart(2,'0')}`;
  return <div class="audio-player"><audio ref={ref} src={src} preload="metadata" onPlaying={()=>setState('playing')} onWaiting={()=>setState('loading')} onPause={()=>setState('idle')} onEnded={()=>{setState('idle');setTime(0);}} onTimeUpdate={e=>setTime(e.currentTarget.currentTime)} onLoadedMetadata={e=>setDuration(Number.isFinite(e.currentTarget.duration)?e.currentTarget.duration:0)} onError={()=>setState('error')}/><div class="audio-main"><button class="audio-play" aria-label={state==='playing'?'Tạm dừng':'Phát câu mẫu'} aria-busy={state==='loading'} onClick={()=>void play()}><Icon name={state==='playing'?'pause':'play'} size={25}/></button><div class="audio-track"><Wave/><span aria-live="polite">{state==='loading'?'Đang tải âm thanh…':state==='error'?'Chạm phát để thử lại':state==='playing'?'Đang phát câu mẫu':'Chạm để nghe mẫu'}</span></div><label class="speed-select"><span class="sr-only">Tốc độ phát</span><select aria-label="Tốc độ phát" value={speed} onChange={e=>{const s=Number(e.currentTarget.value);setSpeed(s);if(ref.current)ref.current.playbackRate=s;}}>{[0.75,1,1.25].map(s=><option value={s}>{s}×</option>)}</select></label></div><div class="audio-seek"><span>{fmt(time)}</span><input aria-label="Vị trí phát" type="range" min="0" max={duration||1} step="0.1" value={time} onInput={e=>{if(ref.current)ref.current.currentTime=Number(e.currentTarget.value);}}/><span>{fmt(duration)}</span></div><button class="replay-link" onClick={()=>{if(ref.current)ref.current.currentTime=0;void playFromStart();}}>↻ Nghe lại từ đầu</button></div>;
  async function playFromStart(){ref.current?.pause();await play();}
}
function Review({progress,due,persist,openLibrary}:{progress:StudyProgress;due:{lesson:StudyLesson;item:StudyLesson['items'][number];key:string}[];persist:(p:StudyProgress)=>void;openLibrary:()=>void}) {
  const [reveal,setReveal]=useState(false);
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{const t=setInterval(()=>setNow(Date.now()),30000);return()=>clearInterval(t);},[]);
  const current=due.find(x=>progress.recalls[x.key].due<=now);
  return <><span class="eyebrow">NHỚ LÂU BẰNG CÁCH TỰ NHỚ LẠI</span><h1 class="page-title">Ôn một chút. Nhớ thêm nhiều.</h1><p class="page-sub">Lịch ôn dựa trên câu trả lời “Đã nhớ” hoặc “Cần ôn lại” của bạn.</p>{current?<section class="exercise-card review-card"><span class="eyebrow">{current.lesson.title} · {due.length} câu đến hạn</span><p class="english-sentence">{current.item.vi}</p><p class="exercise-hint">Thử nói câu này bằng tiếng Anh trước khi mở đáp án.</p>{reveal?<><p class="english-sentence" lang="en">{current.item.en}</p><audio controls src={current.item.audio} preload="none"/><div class="button-row">{[false,true].map(remembered=><button class={remembered?'primary':'secondary'} onClick={()=>{persist({...progress,recalls:{...progress.recalls,[current.key]:scheduleRecall(progress.recalls[current.key],remembered)}});setReveal(false);}}>{remembered?'Đã nhớ':'Cần ôn lại'}</button>)}</div></>:<button class="primary wide" onClick={()=>setReveal(true)}>Hiện đáp án</button>}</section>:<div class="empty-state"><Icon name="check" size={38}/><h2>{Object.keys(progress.recalls).length?'Bạn đã ôn xong các câu đến hạn.':'Bắt đầu xây kho câu của bạn.'}</h2><p>{Object.keys(progress.recalls).length?'Câu đã nhớ sẽ quay lại sau 1, 2, 4 ngày… Câu khó quay lại sau 10 phút.':'Học kỹ năng Nghe và tự đánh giá trí nhớ. App sẽ hẹn bạn ôn đúng lúc.'}</p><button class="primary" onClick={openLibrary}>Chọn bài học <Icon name="arrow" size={18}/></button></div>}</>;
}
