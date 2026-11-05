import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { curriculum } from './study-curriculum.mjs';
const root = resolve(import.meta.dirname, '..');
const electrical = [
  ['electrical-basics', 'Điện cơ bản', 'A2', [
    ['The voltage is two hundred and thirty volts.', 'Điện áp là hai trăm ba mươi vôn.', 'voltage · điện áp'],
    ['Current flows through a closed circuit.', 'Dòng điện chạy qua một mạch kín.', 'current · dòng điện'],
    ['Resistance is measured in ohms.', 'Điện trở được đo bằng ôm.', 'resistance · điện trở'],
    ['This cable has a copper conductor.', 'Cáp này có lõi dẫn bằng đồng.', 'conductor · vật dẫn điện'],
    ['The power supply is not connected.', 'Bộ nguồn chưa được kết nối.', 'power supply · bộ nguồn'],
  ]],
  ['electrical-tools', 'Dụng cụ & đo lường', 'A2', [
    ['We use a multimeter to measure voltage.', 'Chúng tôi dùng đồng hồ vạn năng để đo điện áp.', 'multimeter · đồng hồ vạn năng'],
    ['The clamp meter measures the current.', 'Ampe kìm đo dòng điện.', 'clamp meter · ampe kìm'],
    ['Please pass me the insulated screwdriver.', 'Vui lòng đưa tôi tua vít cách điện.', 'insulated · được cách điện'],
    ['The reading on the display is stable.', 'Số đo trên màn hình ổn định.', 'reading · số đo'],
    ['This tool needs to be calibrated.', 'Dụng cụ này cần được hiệu chuẩn.', 'calibrate · hiệu chuẩn'],
  ]],
  ['electrical-safety', 'Giao tiếp an toàn', 'B1', [
    ['Only authorized personnel may enter this area.', 'Chỉ người được phép mới được vào khu vực này.', 'authorized personnel · người được phép'],
    ['The equipment is locked out for maintenance.', 'Thiết bị được khóa cách ly để bảo trì.', 'locked out · được khóa cách ly'],
    ['Report the damaged insulation to your supervisor.', 'Báo lớp cách điện bị hỏng cho người giám sát.', 'insulation · lớp cách điện'],
    ['Please follow the approved safety procedure.', 'Vui lòng tuân theo quy trình an toàn đã được phê duyệt.', 'procedure · quy trình'],
    ['A qualified electrician will inspect the panel.', 'Một thợ điện có chuyên môn sẽ kiểm tra tủ điện.', 'qualified electrician · thợ điện có chuyên môn'],
  ]],
  ['electrical-panels', 'Tủ điện & bản vẽ', 'B1', [
    ['The circuit breaker has tripped.', 'Aptomat đã nhảy.', 'circuit breaker · aptomat'],
    ['Each terminal has a clear label.', 'Mỗi đầu nối có nhãn rõ ràng.', 'terminal · đầu nối'],
    ['The wiring diagram is inside the cabinet.', 'Sơ đồ đấu dây nằm trong tủ.', 'wiring diagram · sơ đồ đấu dây'],
    ['This relay controls the cooling fan.', 'Rơ le này điều khiển quạt làm mát.', 'relay · rơ le'],
    ['The earth wire is connected to the enclosure.', 'Dây tiếp địa được kết nối với vỏ thiết bị.', 'earth wire · dây tiếp địa'],
  ]],
  ['electrical-motors', 'Động cơ & bảo trì', 'B1', [
    ['The motor is making an unusual noise.', 'Động cơ đang phát ra tiếng ồn bất thường.', 'motor · động cơ'],
    ['The bearing needs to be replaced.', 'Vòng bi cần được thay thế.', 'bearing · vòng bi'],
    ['The maintenance team is checking the fault.', 'Đội bảo trì đang kiểm tra sự cố.', 'fault · sự cố'],
    ['The drive displays an overload warning.', 'Bộ truyền động hiển thị cảnh báo quá tải.', 'overload · quá tải'],
    ['Please record the results in the maintenance log.', 'Vui lòng ghi kết quả vào nhật ký bảo trì.', 'maintenance log · nhật ký bảo trì'],
  ]],
  ['electrical-handover', 'Bàn giao & công việc', 'B1', [
    ['We are waiting for the inspection report.', 'Chúng tôi đang chờ báo cáo kiểm tra.', 'inspection report · báo cáo kiểm tra'],
    ['The installation meets the project requirements.', 'Hệ thống lắp đặt đáp ứng yêu cầu dự án.', 'requirements · yêu cầu'],
    ['Could you send the updated drawings?', 'Bạn có thể gửi bản vẽ cập nhật không?', 'updated drawings · bản vẽ cập nhật'],
    ['The spare parts will arrive on Friday.', 'Phụ tùng thay thế sẽ đến vào thứ Sáu.', 'spare parts · phụ tùng thay thế'],
    ['Let us review the handover checklist together.', 'Chúng ta cùng xem lại danh sách kiểm tra bàn giao.', 'handover · bàn giao'],
  ]],
];
const lessons = electrical.map(([id,title,level,items]) => ({ id,title,level,category:'electrical',items:items.map(([en,vi,focus],i)=>({en,vi,focus,audio:`/audio/study/${id}-${i}.mp3`})) }));
lessons.push(...curriculum.map(([id,title,level,category,items])=>({id,title,level,category,items:items.map(([en,vi,focus],i)=>({en,vi,focus,audio:`/audio/study/${id}-${i}.mp3`}))})));
const index = JSON.parse(readFileSync(resolve(root,'api/content/index.json'),'utf8'));
for (const row of index) {
  const t = JSON.parse(readFileSync(resolve(root,`api/content/${row.id}.json`),'utf8'));
  lessons.push({id:t.id,title:t.name_vi,category:t.track,level:'B1',items:t.sentences.slice(0,5).map((s,i)=>({en:s.en,vi:s.vi,focus:s.focus_vi,audio:`/audio/study/${t.id}-${i}.mp3`}))});
}
lessons.sort((a,b)=>['A1','A2','B1','B2','C1','C2'].indexOf(a.level)-['A1','A2','B1','B2','C1','C2'].indexOf(b.level)||Number(b.category==='foundation')-Number(a.category==='foundation'));
mkdirSync(resolve(root,'web/src/data'),{recursive:true});
writeFileSync(resolve(root,'web/src/data/study.json'),JSON.stringify(lessons,null,2)+'\n');
const facts=JSON.parse(readFileSync(resolve(root,'api/content/pte-exam-facts.json'),'utf8'));
writeFileSync(resolve(root,'web/src/data/pte-guide.json'),JSON.stringify({checked_at:facts.checked_at,tasks:facts.tasks.map(({id,name,name_vi,skills})=>({id,name,name_vi,skills}))},null,2)+'\n');
console.log(`${lessons.length} lessons, ${lessons.reduce((n,l)=>n+l.items.length,0)} practice sentences`);
