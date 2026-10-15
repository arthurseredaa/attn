'use client';

import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowLeft } from 'lucide-react';
import { profileSchema, type QuizAnswerInput, type QuizOptionDto, type QuizQuestionDto } from '@attn/shared';
import { BrowserApiError, browserJson } from '@/lib/browser-api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { SignalFlood, useFloodHover } from './signal-flood';

type Phase = { kind: 'first' } | { kind: 'second'; first: number };

const EASE = [0.22, 1, 0.36, 1] as const;
/** How long a picked option holds its fill before the step moves on. */
const HOLD_MS = 240;

/** One segment per question: done in the signal colour, the current one darker grey (half filled after the first
 * pick), the rest the empty-segment grey. */
function Segments({ total, index, half }: { total: number; index: number; half: boolean }) {
  const reduce = useReducedMotion();
  return (
    <div aria-hidden className="flex gap-[3px]">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={cn('h-1 flex-1 overflow-hidden', i === index ? 'bg-faint' : 'bg-segment')}>
          <motion.span
            className="block h-full bg-signal"
            initial={false}
            animate={{ width: i < index ? '100%' : i === index && half ? '50%' : '0%' }}
            transition={reduce ? { duration: 0 } : { duration: 0.3, ease: EASE }}
          />
        </span>
      ))}
    </div>
  );
}

/** An answer option as a full-width block: a mono letter, then the text; hover floods it like the skill blocks. */
function OptionBlock({
  option,
  letter,
  held,
  disabled,
  onPick,
  buttonRef,
}: {
  option: QuizOptionDto;
  letter: string;
  /** Picked and holding its fill before the step moves on. */
  held: boolean;
  disabled: boolean;
  onPick: (e: MouseEvent<HTMLButtonElement>) => void;
  buttonRef: (el: HTMLButtonElement | null) => void;
}) {
  const { hover, at, setAt, pointIn, handlers } = useFloodHover();
  const on = held || (hover && !disabled);
  return (
    <button
      ref={buttonRef}
      type="button"
      disabled={disabled}
      onClick={(e) => {
        setAt(e.detail > 0 ? pointIn(e) : null);
        onPick(e);
      }}
      {...handlers}
      className="group relative grid w-full grid-cols-[28px_minmax(0,1fr)] gap-x-3 overflow-hidden bg-card px-4 py-4 text-left outline-none disabled:cursor-not-allowed sm:grid-cols-[36px_minmax(0,1fr)] sm:px-5 sm:py-[18px]"
    >
      <SignalFlood on={on} at={at} />
      <span
        className={cn(
          'relative pt-0.5 font-mono text-[15px] leading-snug transition-colors duration-200',
          on ? 'text-signal-foreground' : 'text-faint',
        )}
      >
        {letter}
      </span>
      <span
        className={cn(
          'relative max-w-[75ch] text-base leading-snug transition-colors duration-200 sm:text-[17px]',
          on ? 'text-signal-foreground' : 'text-foreground',
          disabled && !held && 'opacity-50',
        )}
      >
        {option.text}
      </span>
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-0 border-2 border-transparent',
          on ? 'group-focus-visible:border-signal-foreground' : 'group-focus-visible:border-ring',
        )}
      />
    </button>
  );
}

export function QuizRunner({
  questions,
  focus,
  skillNames,
  onSubmitted,
  onExit,
}: {
  questions: QuizQuestionDto[];
  focus?: string[];
  skillNames: Record<string, string>;
  onSubmitted: () => void;
  /** Called by Back on the very first step (e.g. return to the focus step); without it Back is disabled there. */
  onExit?: () => void;
}) {
  const reduce = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>({ kind: 'first' });
  const [answers, setAnswers] = useState<QuizAnswerInput[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<QuizAnswerInput[] | null>(null);
  // The option holding its fill for HOLD_MS before pick() runs; clicks are ignored meanwhile.
  const [held, setHeld] = useState<number | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const refCallbacks = useRef(new Map<string, (el: HTMLButtonElement | null) => void>());
  // Set when a pick came from an option button: keyboard focus then moves to the first option of the next step.
  const refocus = useRef(false);

  useEffect(() => () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
  }, []);

  async function submit(all: QuizAnswerInput[]) {
    setBusy(true);
    setError(null);
    setPending(all);
    try {
      await browserJson('POST', '/onboarding', profileSchema, focus ? { focus, answers: all } : { answers: all });
      onSubmitted();
    } catch (e) {
      setError(e instanceof BrowserApiError ? e.message : 'Could not save your answers. Please try again.');
      setBusy(false);
    }
  }

  const question = questions[index];
  const options = !question
    ? []
    : phase.kind === 'first'
      ? question.options
      : question.options.filter((o) => o.id !== phase.first);

  // The options of a new step mount fresh (the step animates in), so the focus would otherwise drop to the page.
  useEffect(() => {
    if (!refocus.current || !question) return;
    refocus.current = false;
    const first = options[0];
    if (first) buttons.current.get(`${question.id}:${first.id}`)?.focus();
    // options derive from question and phase
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, phase]);

  if (!question) return null;

  function pick(optionId: number) {
    if (busy || !question) return;
    if (phase.kind === 'first') {
      setPhase({ kind: 'second', first: optionId });
      return;
    }
    const next = [...answers, { questionId: question.id, first: phase.first, second: optionId }];
    if (index + 1 < questions.length) {
      setAnswers(next);
      setIndex(index + 1);
      setPhase({ kind: 'first' });
    } else {
      void submit(next);
    }
  }

  function choose(optionId: number) {
    if (busy || held !== null) return;
    // A ref to the list would go stale: the outgoing step's list unmounts after the incoming one mounts.
    refocus.current = document.activeElement?.closest('[data-quiz-options]') != null;
    if (reduce) {
      pick(optionId);
      return;
    }
    setHeld(optionId);
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      setHeld(null);
      pick(optionId);
    }, HOLD_MS);
  }

  const atStart = phase.kind === 'first' && index === 0;

  function back() {
    if (busy || held !== null) return;
    if (phase.kind === 'second') setPhase({ kind: 'first' });
    else if (index > 0) {
      setAnswers(answers.slice(0, -1));
      setIndex(index - 1);
      setPhase({ kind: 'first' });
    } else onExit?.();
  }

  const canBack = !atStart || onExit !== undefined;
  const setRef = (key: string) => {
    let cb = refCallbacks.current.get(key);
    if (!cb) {
      cb = (el) => {
        if (el) buttons.current.set(key, el);
        else buttons.current.delete(key);
      };
      refCallbacks.current.set(key, cb);
    }
    return cb;
  };
  const step = reduce ? { duration: 0 } : { duration: 0.26, ease: EASE };

  return (
    <div className="space-y-8">
      <div className="space-y-2.5">
        <Segments total={questions.length} index={index} half={phase.kind === 'second'} />
        <p className="font-mono text-[13px] text-muted-foreground">
          Question {index + 1} of {questions.length}
        </p>
      </div>
      <div className="relative">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={question.id}
            initial={reduce ? false : { opacity: 0, x: 32 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, x: -32 }}
            transition={step}
            className="w-full"
          >
            <h2 className="text-sm font-medium text-muted-foreground">{skillNames[question.skillId] ?? question.skillId}</h2>
            <p className="mt-2 max-w-[65ch] text-[22px] leading-[1.35] tracking-[-0.015em] sm:text-[26px]">{question.situation}</p>
            <p className="mt-8 text-[15px] font-semibold">
              {phase.kind === 'first' ? 'What would you do?' : "If that option weren't there, what would you do?"}
            </p>
            {/* 1px outlines on 1px gaps: one hairline between the blocks and around the list. */}
            <ol data-quiz-options className="relative mt-3 grid gap-px p-px">
              <AnimatePresence mode="popLayout" initial={false}>
                {options.map((o, i) => (
                  <motion.li
                    key={o.id}
                    layout="position"
                    initial={reduce ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, scale: 0.98 }}
                    transition={step}
                    className="outline outline-border"
                  >
                    <OptionBlock
                      option={o}
                      letter={String.fromCharCode(65 + i)}
                      held={held === o.id}
                      disabled={busy}
                      onPick={() => choose(o.id)}
                      buttonRef={setRef(`${question.id}:${o.id}`)}
                    />
                  </motion.li>
                ))}
              </AnimatePresence>
            </ol>
          </motion.div>
        </AnimatePresence>
      </div>
      {error ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">
          <p>{error}</p>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => pending && void submit(pending)}>
            Try again
          </Button>
        </div>
      ) : null}
      <Button type="button" variant="ghost" className="-ml-2.5" disabled={busy || !canBack} onClick={back}>
        <ArrowLeft aria-hidden />
        {atStart && onExit ? 'Back to focus' : 'Back'}
      </Button>
    </div>
  );
}

export function QuizRetake({ questions, skillNames }: { questions: QuizQuestionDto[]; skillNames: Record<string, string> }) {
  const router = useRouter();
  return (
    <QuizRunner
      questions={questions}
      skillNames={skillNames}
      onSubmitted={() => {
        router.push('/profile');
        router.refresh();
      }}
    />
  );
}
