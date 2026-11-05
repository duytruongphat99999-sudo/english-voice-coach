import { useEffect, useState } from 'preact/hooks';
import MicButton, { type MicPhase } from './MicButton';
import {
  get,
  postForm,
  ApiError,
  type PresentationListItem,
  type PresentationReport,
} from '../lib/api';
import { extFor } from '../lib/recorder';
import { cx } from '../lib/cx';
// Vung toc do PTE Academic thuong cho Oral Fluency, KHONG phai chuan thuyet
// trinh kinh doanh (130-160). Doi 04/09/2026 khi Duy chot muc tieu thi PTE.
// Ban ghi 173 wpm ngay 18/08 tung bi bao "qua nhanh" — theo chuan PTE thi no
// nam giua vung tot. Nguong nay phai khop voi prompts.ts, doi mot ben la lech.
// 06/09: dua sang lib/pace.ts de man Read Aloud dung CHUNG, khong sinh them
// ban sao thu ba cua dung hai con so nay.
import { GOOD_LOW, GOOD_HIGH } from '../lib/pace';

/** Record & Roast — mot man, mot nut (spec §6.6). */
export default function TalkRecorder() {
  const [phase, setPhase] = useState<MicPhase>('idle');
  const [report, setReport] = useState<PresentationReport | null>(null);
  const [error, setError] = useState('');
  // Lich su. API van luu tu dau nhung truoc 04/09 khong man nao goi toi, nen
  // moi ban thu deu bien mat ngay sau khi doc xong bao cao.
  const [history, setHistory] = useState<PresentationListItem[]>([]);
  const [opening, setOpening] = useState<number | null>(null);

  const loadHistory = () => {
    get<PresentationListItem[]>('/presentation')
      .then(setHistory)
      // Lich su hong thi khong duoc chan duong thu bai moi.
      .catch(() => {});
  };

  useEffect(loadHistory, []);

  const send = async (blob: Blob, mime: string, duration: number) => {
    setError('');
    setPhase('busy');
    const form = new FormData();
    form.append('audio', blob, `talk.${extFor(mime)}`);
    form.append('duration_s', String(duration));
    try {
      setReport(await postForm<PresentationReport>('/presentation', form));
      loadHistory();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setPhase('idle');
    }
  };

  const open = async (id: number) => {
    setError('');
    setOpening(id);
    try {
      setReport(await get<PresentationReport>(`/presentation/${id}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setOpening(null);
    }
  };

  if (report) return <Report r={report} onAgain={() => setReport(null)} />;

  const recording = phase === 'recording';

  return (
    <div class="flex min-h-[85dvh] flex-col">
      <div class="flex-1 px-5 pt-8">
        {!recording && (
          <>
            <h1 class="text-[23px] font-bold text-en">Record &amp; Roast</h1>
            <p class="mt-2 text-[14px] leading-relaxed text-vi">
              Nói liền mạch 2–3 phút về một chủ đề công việc. Có mở đầu, thân bài, kết luận. Không đọc
              script.
            </p>

            {phase === 'busy' && (
              <p class="mt-8 rounded-xl bg-surface px-4 py-3 text-[14px] text-vi">
                Đang nghe lại và chấm. Bản ghi dài thì bước này mất 20–60 giây.
              </p>
            )}

            {error && (
              <p class="mt-6 rounded-xl bg-bad/10 px-3 py-2.5 text-[13.5px] leading-snug text-bad">{error}</p>
            )}

            {history.length > 0 && (
              <section class="mt-9">
                <h2 class="mb-2.5 text-[12px] uppercase tracking-wide text-vi">Lần trước</h2>
                <ul class="flex flex-col gap-2">
                  {history.map((h) => {
                    const paceOk = h.wpm >= GOOD_LOW && h.wpm <= GOOD_HIGH;
                    return (
                      <li key={h.id}>
                        <button
                          onClick={() => void open(h.id)}
                          disabled={opening !== null}
                          class="flex w-full items-center justify-between rounded-xl border border-line bg-surface px-3.5 py-3 text-left disabled:opacity-50"
                        >
                          <span class="text-[13.5px] text-vi">{viDate(h.created_at)}</span>
                          <span class="flex items-center gap-3 text-[13px] tabular-nums">
                            <span class={paceOk ? 'text-accent' : 'text-warn'}>{h.wpm} wpm</span>
                            <span class="text-vi">{h.filler_count} filler</span>
                            <span class="text-vi">{opening === h.id ? '…' : '›'}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <p class="mt-2.5 text-[12px] text-vi">Chạm một dòng để đọc lại báo cáo đầy đủ.</p>
              </section>
            )}
          </>
        )}
      </div>

      <div class="sticky bottom-0 border-t border-line bg-ink/95 px-4 pb-3 pt-2 backdrop-blur">
        <MicButton
          phase={phase}
          maxSeconds={240}
          hint="Chạm lại khi nói xong"
          onStateChange={(p) => setPhase((cur) => (cur === 'busy' ? cur : p))}
          onError={(m) => {
            setError(m);
            setPhase('idle');
          }}
          onDone={(blob, mime, duration) => void send(blob, mime, duration)}
        />
      </div>
    </div>
  );
}

function Report({ r, onAgain }: { r: PresentationReport; onAgain: () => void }) {
  const fillers = Object.entries(r.filler_breakdown ?? {}).sort((a, b) => b[1] - a[1]);
  const paceOk = r.wpm >= GOOD_LOW && r.wpm <= GOOD_HIGH;

  return (
    <div class="px-5 pb-10 pt-7">
      <h1 class="text-[22px] font-bold text-en">Báo cáo</h1>
      {/* Chi hien khi dang xem lai ban cu — ban vua thu xong thi khoi phai noi. */}
      {r.created_at && <p class="mt-1 text-[13px] text-vi">{viDate(r.created_at)}</p>}

      <div class="mt-5 grid grid-cols-3 gap-2.5">
        <Metric
          value={String(r.wpm)}
          label="wpm"
          sub={`${GOOD_LOW}–${GOOD_HIGH}`}
          tone={paceOk ? 'good' : 'warn'}
        />
        <Metric
          value={String(r.filler_count)}
          label="filler"
          sub={`${Math.round((r.filler_count / Math.max(1, r.words)) * 1000) / 10}%`}
          tone={r.filler_count <= r.words * 0.03 ? 'good' : 'warn'}
        />
        <Metric
          value={`${r.report.structure_score}/10`}
          label="cấu trúc"
          sub={`${Math.round(r.duration_s)}s`}
          tone={r.report.structure_score >= 7 ? 'good' : 'warn'}
        />
      </div>

      <Section title="Tốc độ">
        <p class="text-[14px] leading-relaxed text-vi">{r.report.pace_vi}</p>
      </Section>

      <Section title="Cấu trúc">
        <p class="text-[14px] leading-relaxed text-vi">{r.report.structure_vi}</p>
      </Section>

      {fillers.length > 0 && (
        <Section title="Từ đệm">
          <div class="flex flex-wrap gap-1.5">
            {fillers.map(([w, n]) => (
              <span key={w} class="rounded-full bg-warn/10 px-2.5 py-1 text-[12.5px] text-warn">
                {w} ×{n}
              </span>
            ))}
          </div>
        </Section>
      )}

      {r.report.fixes.length > 0 && (
        <Section title="Câu nên sửa">
          <ul class="flex flex-col gap-3">
            {r.report.fixes.map((f, i) => (
              <li key={i} class="rounded-xl border border-line bg-surface px-3.5 py-3">
                <p class="text-[13px] leading-snug text-vi line-through decoration-vi/40">{f.you_said}</p>
                <p class="mt-1.5 text-[15.5px] font-semibold leading-relaxed text-accent">{f.better}</p>
                <p class="mt-1.5 text-[12.5px] leading-snug text-vi">{f.why_vi}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Lần sau tập trung vào">
        <p class="text-[15px] font-medium leading-relaxed text-en-dim">{r.report.next_focus_vi}</p>
      </Section>

      <Section title="Transcript">
        <Transcript text={r.transcript} />
      </Section>

      <button
        onClick={onAgain}
        class="mt-8 w-full rounded-xl bg-accent py-4 text-[16px] font-semibold text-ink"
      >
        Thu lại
      </button>
      <a href="/coach" class="mt-3 block py-2 text-center text-[14px] text-vi">
        Về trang chủ
      </a>
    </div>
  );
}

/** Highlight filler ngay trong transcript (spec §11). */
function Transcript({ text }: { text: string }) {
  const FILLERS = /\b(um|uh|erm|like|you know|sort of|kind of|basically|actually|literally|i mean|obviously|honestly)\b/gi;
  const parts: (string | { f: string })[] = [];
  let last = 0;
  for (const m of text.matchAll(FILLERS)) {
    const at = m.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    parts.push({ f: m[0] });
    last = at + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));

  return (
    <p class="text-[14.5px] leading-relaxed text-en-dim break-words">
      {parts.map((p, i) =>
        typeof p === 'string' ? (
          <span key={i}>{p}</span>
        ) : (
          <mark key={i} class="rounded bg-warn/20 px-1 text-warn">
            {p.f}
          </mark>
        ),
      )}
    </p>
  );
}

function Metric({
  value,
  label,
  sub,
  tone,
}: {
  value: string;
  label: string;
  sub: string;
  tone: 'good' | 'warn';
}) {
  return (
    <div class="rounded-2xl border border-line bg-surface px-2 py-4 text-center">
      <p class={cx('text-[24px] font-bold leading-none', tone === 'good' ? 'text-accent' : 'text-warn')}>
        {value}
      </p>
      <p class="mt-1.5 text-[12px] text-en-dim">{label}</p>
      <p class="text-[11px] text-vi">{sub}</p>
    </div>
  );
}

/**
 * ISO -> "18/08, 15:06". Gio Viet Nam.
 *
 * created_at ghi bang nowIso() nen la UTC co hau to Z; de trinh duyet tu doi
 * sang gio may. Ghim timeZone de may cua ai cung ra cung mot con so.
 */
function viDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function Section({ title, children }: { title: string; children: preact.ComponentChildren }) {
  return (
    <section class="mt-7">
      <h2 class="mb-2.5 text-[12px] uppercase tracking-wide text-vi">{title}</h2>
      {children}
    </section>
  );
}
