import { Button } from '@/components/ui/button';

const REPO_URL = process.env.NEXT_PUBLIC_REPO_URL;
const AUTHOR = process.env.NEXT_PUBLIC_AUTHOR_NAME;

const DEMO_BATCHES = [
  { batch: '4412', product: 'Oat & honey granola bar', line: 'Line 3' },
  { batch: '5108', product: 'Sourdough sandwich loaf', line: 'Line 1' },
  { batch: '6230', product: 'Chilled tomato & basil soup', line: 'Line 5' },
];

const PIPELINE = [
  { stage: 'STT', model: 'Deepgram Nova-3' },
  { stage: 'Turn', model: 'LiveKit audio turn detector' },
  { stage: 'LLM', model: 'GPT-4.1 mini + tools' },
  { stage: 'TTS', model: 'Cartesia Sonic-3' },
];

interface WelcomeViewProps {
  startButtonText: string;
  onStartCall: () => void;
}

export const WelcomeView = ({
  startButtonText,
  onStartCall,
  ref,
}: React.ComponentProps<'div'> & WelcomeViewProps) => {
  return (
    <div ref={ref} className="px-4">
      <section className="bg-background mx-auto flex max-w-xl flex-col items-center py-16 text-center">
        <p className="text-muted-foreground font-mono text-xs tracking-wider uppercase">
          Northbrook Foods · fictional demo
        </p>
        <h1 className="text-foreground mt-3 text-3xl font-semibold tracking-tight text-balance md:text-4xl">
          Line QA voice agent
        </h1>
        <p className="text-muted-foreground mt-4 max-w-prose leading-7 text-pretty">
          Operators on a food production line log a quality incident by talking, hands still in
          gloves. The agent looks up the batch, captures the defect, reads it back and logs it,
          while the record and per-turn latency update live on screen.
        </p>

        <Button
          size="lg"
          onClick={onStartCall}
          className="mt-8 w-64 rounded-full font-mono text-xs font-bold tracking-wider uppercase"
        >
          {startButtonText}
        </Button>
        <p className="text-muted-foreground mt-3 text-xs">
          Needs your microphone · sessions last up to 3 minutes
        </p>

        <div className="border-border mt-10 w-full rounded-xl border p-4 text-left">
          <h2 className="font-mono text-xs font-bold tracking-wider uppercase">Try saying</h2>
          <p className="text-foreground mt-2 text-sm leading-6">
            &ldquo;I need to log a seal failure on batch forty-four twelve, about three hundred
            packs.&rdquo;
          </p>
          <p className="text-muted-foreground mt-3 text-xs leading-5">Batches on file:</p>
          <ul className="mt-1 space-y-1 font-mono text-xs">
            {DEMO_BATCHES.map((b) => (
              <li key={b.batch} className="flex justify-between gap-4">
                <span>{b.batch}</span>
                <span className="text-muted-foreground truncate">
                  {b.product} · {b.line}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-6 grid w-full grid-cols-2 gap-2 md:grid-cols-4">
          {PIPELINE.map((p) => (
            <div key={p.stage} className="border-border rounded-lg border px-3 py-2 text-left">
              <p className="text-muted-foreground font-mono text-[11px] uppercase">{p.stage}</p>
              <p className="text-foreground text-xs leading-4">{p.model}</p>
            </div>
          ))}
        </div>
        <p className="text-muted-foreground mt-2 text-xs">
          WebRTC transport and models via LiveKit Cloud and LiveKit Inference
        </p>

        <p className="text-muted-foreground mt-10 text-xs leading-5">
          {AUTHOR ? <>Built by {AUTHOR} with </> : <>Built with </>}
          <a
            target="_blank"
            rel="noopener noreferrer"
            href="https://docs.livekit.io/agents/"
            className="underline underline-offset-4"
          >
            LiveKit Agents
          </a>
          {REPO_URL && (
            <>
              {' · '}
              <a
                target="_blank"
                rel="noopener noreferrer"
                href={REPO_URL}
                className="underline underline-offset-4"
              >
                Source on GitHub
              </a>
            </>
          )}
          . Company, products and batches are fictional.
        </p>
      </section>
    </div>
  );
};
