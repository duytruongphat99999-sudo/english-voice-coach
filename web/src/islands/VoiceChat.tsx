import { useEffect, useRef, useState } from 'preact/hooks';
import MicButton, { type MicPhase } from './MicButton';
import { postSse, post, ApiError, type Correction, type VocabItem } from '../lib/api';
import { AudioQueue, extFor } from '../lib/recorder';
import { cx } from '../lib/cx';

type Msg =
  | { role: 'user'; text: string; corrections?: Correction[]; pending?: boolean }
  | { role: 'model'; text: string; audio: string[] };

type Props = {
  scenario: string;
  scenarioVi: string;
  flow: 'daily' | 'extra';
  /**
   * 'fr' = chang 4 tieng Phap (FrSession, 12/09). Chi doi loi thoat, chu goi y
   * va canh bao; route /chat tu nhan ra tieng Phap qua scenario. Mac dinh 'en'
   * nen man tieng Anh giu nguyen.
   */
  lang?: 'en' | 'fr';
};

export default function VoiceChat({ scenario, scenarioVi, flow, lang = 'en' }: Props) {
  const fr = lang === 'fr';
  const home = fr ? '/fr-roadmap' : '/';
  const [messages, setMessages] = useState<Msg[]>([]);
  const [phase, setPhase] = useState<MicPhase>('idle');
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [turns, setTurns] = useState(0);
  const [targetTurns, setTargetTurns] = useState(8);
  const [vocabTotal, setVocabTotal] = useState(0);
  const [error, setError] = useState('');
  const [warn, setWarn] = useState('');
  const [speaking, setSpeaking] = useState(false);
  const [ending, setEnding] = useState(false);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState('');

  const queueRef = useRef(new AudioQueue());
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastBlobRef = useRef<{ blob: Blob; mime: string } | null>(null);

  useEffect(() => {
    const q = queueRef.current;
    q.onStart = () => setSpeaking(true);
    q.onIdle = () => setSpeaking(false);
    return () => q.reset();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, phase]);

  const sendText = async () => {
    const text = draft.trim();
    if (!text) return;
    const form = new FormData();
    form.append('text', text);
    form.append('scenario', scenario);
    if (sessionId) form.append('session_id', String(sessionId));
    setDraft('');
    await submit(form);
  };

  const send = async (blob: Blob, mime: string) => {
    const form = new FormData();
    form.append('audio', blob, `turn.${extFor(mime)}`);
    form.append('scenario', scenario);
    if (sessionId) form.append('session_id', String(sessionId));
    await submit(form);
  };

  const submit = async (form: FormData) => {
    setError('');
    setWarn('');
    setPhase('busy');
    queueRef.current.reset();

    // Cho cho cho user hien ngay, chua co chu — do tre STT ~2s.
    setMessages((m) => [...m, { role: 'user', text: '', pending: true }]);

    try {
      await postSse('/chat', form, (event, data) => {
        if (event === 'session') {
          setSessionId(data.session_id);
        } else if (event === 'transcript') {
          setMessages((m) => {
            const copy = [...m];
            for (let i = copy.length - 1; i >= 0; i -= 1) {
              const cur = copy[i]!;
              if (cur.role === 'user' && cur.pending) {
                copy[i] = { role: 'user', text: data.text };
                break;
              }
            }
            return copy;
          });
        } else if (event === 'reply') {
          setMessages((m) => [...m, { role: 'model', text: data.text, audio: [] }]);
        } else if (event === 'audio') {
          queueRef.current.push(data.index, data.b64, data.mime);
          setMessages((m) => {
            const copy = [...m];
            const last = copy[copy.length - 1];
            if (last?.role === 'model') copy[copy.length - 1] = { ...last, audio: [...last.audio, data.b64] };
            return copy;
          });
        } else if (event === 'feedback') {
          setMessages((m) => {
            const copy = [...m];
            for (let i = copy.length - 1; i >= 0; i -= 1) {
              const cur = copy[i]!;
              if (cur.role === 'user') {
                copy[i] = { ...cur, corrections: data.corrections ?? [] };
                break;
              }
            }
            return copy;
          });
          setVocabTotal((v) => v + (data.vocab_added ?? 0));
          setTurns(data.turn_count ?? 0);
          setTargetTurns(data.target_turns ?? 8);
        } else if (event === 'warn') {
          setWarn(data.message);
        } else if (event === 'error') {
          setError(data.message);
          setMessages((m) => m.filter((x) => !(x.role === 'user' && x.pending)));
        }
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
      setMessages((m) => m.filter((x) => !(x.role === 'user' && x.pending)));
    } finally {
      setPhase('idle');
    }
  };

  const retry = () => {
    const last = lastBlobRef.current;
    if (!last) return;
    // Bo luot user hong o cuoi roi gui lai.
    setMessages((m) => {
      const copy = [...m];
      while (copy.length && copy[copy.length - 1]!.role === 'user') copy.pop();
      return copy;
    });
    void send(last.blob, last.mime);
  };

  const finish = async () => {
    if (!sessionId) return;
    setEnding(true);
    try {
      await post('/session/end', { session_id: sessionId });
      const url = fr ? home : flow === 'daily' ? '/coach?step=3' : '/coach';
      window.location.href = url;
    } catch (e) {
      setError((e as Error).message);
      setEnding(false);
    }
  };

  const recording = phase === 'recording';
  const canFinish = turns >= targetTurns;

  return (
    <div class="flex min-h-dvh flex-col">
      {/* Thanh tren gon. An khi dang noi. */}
      {!recording && (
        <header class="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-ink/95 px-4 py-3 backdrop-blur">
          <div class="min-w-0">
            <p class="truncate text-[15px] font-semibold text-en">{scenarioVi}</p>
            <p class="text-[12px] text-vi">
              Lượt {turns}/{targetTurns}
              {vocabTotal > 0 && <span class="text-accent"> · +{vocabTotal} từ vào kho</span>}
            </p>
          </div>
          <a href={home} class="shrink-0 rounded-lg px-2 py-1 text-[13px] text-vi hover:text-en">
            Thoát
          </a>
        </header>
      )}

      {/* Khu hoi thoai. Bien mat khi mic bat (spec §6.1). */}
      <div class={cx('flex-1 px-4', recording ? 'opacity-0 pointer-events-none' : 'py-4')}>
        {messages.length === 0 && !recording && (
          <div class="mt-10 text-center">
            <p class="text-[17px] font-semibold text-en">Chạm mic rồi mở lời trước</p>
            <p class="mt-2 text-[14px] text-vi">
              {fr
                ? 'Nói tiếng Pháp đơn giản, chậm cũng được. Bí thì gõ chữ.'
                : 'Nói tiếng Anh tự nhiên, sai cũng không sao — sửa nằm dưới câu, xem sau cũng được.'}
            </p>
          </div>
        )}

        {fr && !recording && (
          <p class="mb-4 rounded-xl bg-warn/10 px-3 py-2.5 text-[12.5px] leading-snug text-warn">
            Không chấm điểm. Máy nghe tiếng Pháp hay nghe nhầm giọng người mới học, nên chỗ "sửa câu" của AI ở đây
            chưa đáng tin — nếu thấy lạ, bấm nghe lại và tự so.
          </p>
        )}

        <div class="flex flex-col gap-4">
          {messages.map((m, i) =>
            m.role === 'user' ? (
              <UserBubble key={i} msg={m} fr={fr} />
            ) : (
              <ModelBubble key={i} msg={m} />
            ),
          )}
        </div>

        {speaking && !recording && (
          <p class="mt-3 text-center text-[13px] text-accent">🔊 đang nói…</p>
        )}

        {warn && <Banner tone="warn" text={warn} />}
        {error && (
          <div class="mt-4">
            <Banner tone="bad" text={error} />
            {lastBlobRef.current && (
              <button
                onClick={retry}
                class="mt-2 w-full rounded-xl border border-line bg-surface py-3 text-[15px] font-medium text-en"
              >
                Gửi lại câu vừa nói
              </button>
            )}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Nut mic — hanh dong chinh, luon o day man hinh. */}
      <div class="sticky bottom-0 border-t border-line bg-ink/95 px-4 pb-3 pt-2 backdrop-blur">
        {typing ? (
          <div class="mb-2 flex items-end gap-2">
            <textarea
              value={draft}
              rows={2}
              placeholder={fr ? 'Gõ câu tiếng Pháp…' : 'Gõ câu tiếng Anh…'}
              disabled={phase === 'busy'}
              onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
              onKeyDown={(e) => {
                // Enter gui, Shift+Enter xuong dong.
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void sendText();
                }
              }}
              class="min-h-[52px] flex-1 resize-none rounded-xl border border-line bg-surface px-3.5 py-3 text-[16px] text-en outline-none placeholder:text-vi focus:border-accent"
            />
            <button
              onClick={() => void sendText()}
              disabled={!draft.trim() || phase === 'busy'}
              class="h-[52px] shrink-0 rounded-xl bg-accent px-5 text-[15px] font-semibold text-ink disabled:opacity-40"
            >
              Gửi
            </button>
          </div>
        ) : (
        <MicButton
          phase={phase}
          onStateChange={(p) => setPhase((cur) => (cur === 'busy' ? cur : p))}
          hint={messages.length === 0 ? 'Bắt đầu bằng một câu chào' : 'Nói xong thì chạm lại để gửi'}
          onError={(msg) => {
            setError(msg);
            setPhase('idle');
          }}
          onDone={(blob, mime) => {
            lastBlobRef.current = { blob, mime };
            void send(blob, mime);
          }}
        />
        )}

        {/* Noi hoac go — co luc khong tien mo mieng ma van muon giu chuoi. */}
        {phase !== 'recording' && (
          <button
            onClick={() => setTyping(!typing)}
            class="mb-1 w-full py-1.5 text-center text-[12.5px] text-vi"
          >
            {typing ? '← quay lại nói' : 'không tiện nói? gõ chữ →'}
          </button>
        )}

        {canFinish && phase === 'idle' && (
          <button
            onClick={finish}
            disabled={ending}
            class="mb-1 w-full rounded-xl bg-accent py-3.5 text-[16px] font-semibold text-ink disabled:opacity-60"
          >
            {ending ? 'Đang lưu…' : `Xong buổi này (${turns} lượt)`}
          </button>
        )}
      </div>

    </div>
  );
}

function UserBubble({ msg, fr = false }: { msg: Extract<Msg, { role: 'user' }>; fr?: boolean }) {
  const [open, setOpen] = useState(false);
  if (msg.pending) {
    return (
      <div class="self-end rounded-2xl rounded-br-md bg-surface-2 px-4 py-3">
        <span class="text-[15px] text-vi">đang nghe lại câu của bạn…</span>
      </div>
    );
  }
  const errs = msg.corrections ?? [];
  return (
    <div class="flex flex-col items-end gap-1.5">
      <div class="max-w-[85%] rounded-2xl rounded-br-md bg-surface-2 px-4 py-3">
        <p class="text-[16px] leading-relaxed text-en break-words">{msg.text}</p>
      </div>

      {msg.corrections !== undefined &&
        (errs.length === 0 ? (
          <span class="rounded-full bg-accent/10 px-2.5 py-1 text-[12px] text-accent">
            {fr ? '✓ AI không thấy lỗi' : '✓ câu chuẩn'}
          </span>
        ) : (
          <div class="max-w-[85%]">
            <button
              onClick={() => setOpen(!open)}
              class="rounded-full bg-surface px-2.5 py-1 text-[12px] text-vi transition-colors hover:text-en-dim"
            >
              {open ? 'thu gọn' : `${errs.length} chỗ nói tự nhiên hơn được`}
            </button>
            {open && (
              <ul class="mt-2 flex flex-col gap-2.5">
                {errs.map((c, i) => (
                  <li key={i} class="rounded-xl border border-line bg-surface px-3 py-2.5">
                    <p class="text-[13px] text-vi line-through decoration-vi/50">{c.you_said}</p>
                    <p class="mt-1 text-[15px] font-semibold text-accent">{c.better}</p>
                    <p class="mt-1.5 text-[12.5px] leading-snug text-vi">{c.why_vi}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
    </div>
  );
}

function ModelBubble({ msg }: { msg: Extract<Msg, { role: 'model' }> }) {
  const replay = async () => {
    for (const b64 of msg.audio) {
      const bin = atob(b64);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) buf[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([buf], { type: 'audio/mpeg' }));
      await new Promise<void>((resolve) => {
        const a = new Audio(url);
        a.onended = () => resolve();
        a.onerror = () => resolve();
        void a.play().catch(() => resolve());
      });
      URL.revokeObjectURL(url);
    }
  };

  return (
    <div class="flex max-w-[88%] flex-col gap-1.5 self-start">
      <div class="rounded-2xl rounded-bl-md border border-line bg-surface px-4 py-3">
        <p class="text-[16.5px] font-medium leading-relaxed text-en break-words">{msg.text}</p>
      </div>
      {msg.audio.length > 0 && (
        <button onClick={replay} class="self-start px-1 text-[12px] text-vi hover:text-accent">
          🔊 nghe lại
        </button>
      )}
    </div>
  );
}

function Banner({ tone, text }: { tone: 'warn' | 'bad'; text: string }) {
  return (
    <p
      class={cx(
        'mt-3 rounded-xl px-3 py-2.5 text-[13.5px] leading-snug',
        tone === 'bad' ? 'bg-bad/10 text-bad' : 'bg-warn/10 text-warn',
      )}
    >
      {text}
    </p>
  );
}
