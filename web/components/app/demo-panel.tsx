'use client';

import { useCallback, useEffect, useState } from 'react';
import { useDataChannel } from '@livekit/components-react';
import { cn } from '@/lib/shadcn/utils';

type Incident = {
  status?: 'draft' | 'confirmed' | 'logged';
  batch?: string;
  product?: string;
  line?: string;
  shift?: string;
  defect_type?: string;
  severity?: 'critical' | 'major' | 'minor' | string;
  units_affected?: number;
  description?: string;
  reported_by?: string;
  reference?: string;
  logged_at?: string;
};

type LatencyRow = {
  speech_id: string;
  eou_ms: number;
  stt_ms?: number;
  llm_ttft_ms: number;
  tts_ttfb_ms: number;
  total_ms: number;
};

const decoder = new TextDecoder();

function parse<T>(payload: Uint8Array): T | null {
  try {
    return JSON.parse(decoder.decode(payload)) as T;
  } catch {
    return null;
  }
}

const SESSION_LIMIT_SECONDS = Number(process.env.NEXT_PUBLIC_SESSION_LIMIT_SECONDS ?? 180);

function useCountdown(seconds: number) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    const started = Date.now();
    const id = setInterval(() => {
      setLeft(Math.max(0, seconds - Math.floor((Date.now() - started) / 1000)));
    }, 1000);
    return () => clearInterval(id);
  }, [seconds]);
  const m = Math.floor(left / 60);
  const s = String(left % 60).padStart(2, '0');
  return `${m}:${s}`;
}

const SEVERITY_STYLES: Record<string, string> = {
  critical: 'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30',
  major: 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/30',
  minor: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border-emerald-500/30',
};

function Field({ label, value }: { label: string; value?: string | number }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground text-[11px] tracking-wide uppercase">{label}</dt>
      <dd
        className={cn(
          'truncate text-sm',
          value === undefined || value === '' ? 'text-muted-foreground/60' : 'text-foreground'
        )}
      >
        {value === undefined || value === '' ? '—' : value}
      </dd>
    </div>
  );
}

function ms(v?: number) {
  return v === undefined ? '—' : `${v}`;
}

export function DemoPanel({ className }: { className?: string }) {
  const [incident, setIncident] = useState<Incident>({});
  const [rows, setRows] = useState<LatencyRow[]>([]);
  const remaining = useCountdown(SESSION_LIMIT_SECONDS);

  const onIncident = useCallback((msg: { payload: Uint8Array }) => {
    const data = parse<Incident>(msg.payload);
    if (data) setIncident(data);
  }, []);
  const onLatency = useCallback((msg: { payload: Uint8Array }) => {
    const data = parse<LatencyRow>(msg.payload);
    if (data)
      setRows((prev) => [...prev.filter((r) => r.speech_id !== data.speech_id), data].slice(-6));
  }, []);

  useDataChannel('qa.incident', onIncident);
  useDataChannel('qa.latency', onLatency);

  const logged = incident.status === 'logged';
  const last = rows.at(-1);
  const median = rows.length
    ? [...rows].map((r) => r.total_ms).sort((a, b) => a - b)[Math.floor(rows.length / 2)]
    : undefined;

  return (
    <aside
      className={cn(
        'bg-card/90 text-card-foreground border-border z-40 flex flex-col gap-3 rounded-xl border p-4 shadow-sm backdrop-blur',
        className
      )}
      aria-label="Live incident record and latency"
    >
      {/* Incident record */}
      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="font-mono text-xs font-bold tracking-wider uppercase">Incident record</h2>
          <span
            className={cn(
              'rounded-full border px-2 py-0.5 font-mono text-[11px] uppercase',
              logged
                ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-800 dark:text-emerald-300'
                : 'border-border text-muted-foreground'
            )}
          >
            {logged ? `Logged · ${incident.reference}` : incident.batch ? 'Draft' : 'Waiting'}
          </span>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
          <Field label="Batch" value={incident.batch} />
          <Field
            label="Line · shift"
            value={incident.line && `${incident.line} · ${incident.shift}`}
          />
          <div className="col-span-2">
            <Field label="Product" value={incident.product} />
          </div>
          <Field label="Defect" value={incident.defect_type} />
          <div className="min-w-0">
            <dt className="text-muted-foreground text-[11px] tracking-wide uppercase">Severity</dt>
            <dd>
              {incident.severity ? (
                <span
                  className={cn(
                    'inline-block rounded border px-1.5 py-0.5 text-xs font-medium capitalize',
                    SEVERITY_STYLES[incident.severity] ?? 'border-border'
                  )}
                >
                  {incident.severity}
                </span>
              ) : (
                <span className="text-muted-foreground/60 text-sm">—</span>
              )}
            </dd>
          </div>
          <Field label="Units affected" value={incident.units_affected?.toLocaleString()} />
          <Field label="Reported by" value={incident.reported_by} />
          <div className="col-span-2 hidden md:block">
            <Field label="Description" value={incident.description} />
          </div>
        </dl>
      </section>

      {/* Latency */}
      <section className="border-border border-t pt-3">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h2 className="font-mono text-xs font-bold tracking-wider uppercase">
            Turn latency (ms)
          </h2>
          {median !== undefined && (
            <span className="text-muted-foreground font-mono text-[11px]">median {median}</span>
          )}
        </div>

        {rows.length === 0 ? (
          <p className="text-muted-foreground text-xs leading-5">
            Each reply shows end-of-turn wait, LLM time to first token and TTS time to first audio,
            straight from the agent&apos;s metrics.
          </p>
        ) : (
          <>
            {/* Mobile: last turn only */}
            <p className="font-mono text-xs md:hidden">
              last turn: EOT {ms(last?.eou_ms)} · LLM {ms(last?.llm_ttft_ms)} · TTS{' '}
              {ms(last?.tts_ttfb_ms)} = <strong>{ms(last?.total_ms)}</strong>
            </p>
            {/* Desktop: table */}
            <table className="hidden w-full font-mono text-xs md:table">
              <thead className="text-muted-foreground text-[11px]">
                <tr>
                  <th className="pb-1 text-left font-normal">#</th>
                  <th className="pb-1 text-right font-normal">EOT</th>
                  <th className="pb-1 text-right font-normal">LLM</th>
                  <th className="pb-1 text-right font-normal">TTS</th>
                  <th className="pb-1 text-right font-normal">Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.speech_id} className="border-border/60 border-t">
                    <td className="py-1">{i + 1}</td>
                    <td className="py-1 text-right">{r.eou_ms}</td>
                    <td className="py-1 text-right">{r.llm_ttft_ms}</td>
                    <td className="py-1 text-right">{r.tts_ttfb_ms}</td>
                    <td className="py-1 text-right font-bold">{r.total_ms}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        <p className="text-muted-foreground mt-2 hidden text-[11px] leading-4 md:block">
          Sum of server-side stages. With preemptive generation the LLM can start before end-of-turn
          is final, so real time-to-reply is often lower. Network to your browser is extra.
        </p>
      </section>

      <p className="text-muted-foreground border-border border-t pt-2 font-mono text-[11px]">
        Demo session ends in {remaining}
      </p>
    </aside>
  );
}
