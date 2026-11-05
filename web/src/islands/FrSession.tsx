import { useEffect, useState } from 'preact/hooks';
import VoiceChat from './VoiceChat';
import { get, type FrRoadmap } from '../lib/api';
import { qp } from '../lib/qs';

/**
 * Chang 4 tieng Phap: tro chuyen voi AI. Dung lai VoiceChat (route /chat chung —
 * may chu tu nhan ra tieng Phap qua scenario 'topic:fr_*'), chi doi ten, loi
 * thoat va cau canh bao. KHONG diem, KHONG dao tu vao kho (Duy chot 12/09).
 */
export default function FrSession() {
  const want = qp('scenario');
  const [nameVi, setNameVi] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!want.startsWith('topic:fr_')) {
      setError('Thiếu chủ đề tiếng Pháp.');
      return;
    }
    const id = want.slice('topic:'.length);
    get<FrRoadmap>('/fr/learn/topics')
      .then((r) => {
        const t = r.topics.find((x) => x.id === id);
        if (!t) setError(`Không có chủ đề "${id}".`);
        else setNameVi(`${t.emoji} ${t.name_vi}`);
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  if (error) {
    return (
      <div class="flex min-h-dvh flex-col items-center justify-center px-8 text-center">
        <p class="text-[16px] font-semibold text-bad">{error}</p>
        <a href="/fr-roadmap" class="mt-6 text-[14px] text-vi">
          Về bài học
        </a>
      </div>
    );
  }
  if (!nameVi) return <p class="px-5 py-16 text-center text-[14px] text-vi">Đang mở tình huống…</p>;
  return <VoiceChat scenario={want} scenarioVi={nameVi} flow="extra" lang="fr" />;
}
