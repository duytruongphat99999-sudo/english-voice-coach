import { useEffect, useState } from 'preact/hooks';
import VoiceChat from './VoiceChat';
import { get, type Roadmap, type ScenarioBrief } from '../lib/api';
import { qp } from '../lib/qs';

/**
 * Trang /session la file tinh nen scenario chi biet duoc o phia client.
 * Island nay doc query, tra ten tieng Viet, roi moi dung VoiceChat.
 */
export default function SessionEntry() {
  const flow = qp('flow', 'extra') === 'daily' ? 'daily' : 'extra';
  const [scenario, setScenario] = useState(qp('scenario'));
  const [nameVi, setNameVi] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const want = qp('scenario');

    // Chang 4 cua mot chu de di vao day voi id dang `topic:<chu_de>`, nhung
    // GET /scenarios chi liet ke 5 tinh huong business (routes/chat.ts) nen tim
    // khong bao gio ra. Backend VAN ho tro day du — config.getScenario() xu ly
    // dung tien to `topic:` — chi rieng route liet ke la khong co. Tra ten qua
    // /learn/topics (route co san, da tra name_vi cua ca 20 chu de) thay vi
    // nhet 20 chu de vao /scenarios: danh sach do dang nuoi man "Luyen them",
    // phong no tu 5 len 25 muc la doi mot man dang chay tot.
    if (want.startsWith('topic:')) {
      const topicId = want.slice('topic:'.length);
      get<Roadmap>('/learn/topics')
        .then((r) => {
          const t = r.topics.find((x) => x.id === topicId);
          if (!t) {
            setError(`Không có chủ đề "${topicId}".`);
            return;
          }
          setScenario(want);
          setNameVi(t.name_vi);
        })
        .catch((e) => setError(String(e.message ?? e)));
      return;
    }

    get<ScenarioBrief[]>('/scenarios')
      .then((list) => {
        if (!list.length) {
          setError('Chua cau hinh scenario nao.');
          return;
        }
        // Khong con `?? list[0]` khi query CO ghi scenario ma tra khong ra.
        // Cai fallback do bien "khong tra duoc" thanh "mot buoi hoc sai nhung
        // trong nhu that" — nguoi hoc khong he biet minh dang tap nham bai.
        // Vao thang /session khong kem query (man "Luyen them") thi van lay
        // cai dau tien nhu cu, do la y dinh that.
        const use = want ? list.find((s) => s.id === want) : list[0]!;
        if (!use) {
          setError(`Không có tình huống "${want}".`);
          return;
        }
        setScenario(use.id);
        setNameVi(use.name_vi);
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  if (error) {
    return (
      <div class="flex min-h-dvh flex-col items-center justify-center px-8 text-center">
        <p class="text-[16px] font-semibold text-bad">{error}</p>
        <a href="/coach" class="mt-6 text-[14px] text-vi">
          Về trang chủ
        </a>
      </div>
    );
  }

  if (!nameVi) {
    return <p class="px-5 py-16 text-center text-[14px] text-vi">Đang mở tình huống…</p>;
  }

  return <VoiceChat scenario={scenario} scenarioVi={nameVi} flow={flow} />;
}
