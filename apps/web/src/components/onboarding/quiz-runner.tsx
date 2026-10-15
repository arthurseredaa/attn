'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowLeft, Check } from 'lucide-react';
import { profileSchema, type QuizAnswerInput, type QuizOptionDto, type QuizQuestionDto } from '@attn/shared';
import { BrowserApiError, browserJson } from '@/lib/browser-api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

type Phase = { kind: 'first' } | { kind: 'second'; first: number };

const EASE = [0.22, 1, 0.36, 1] as const;
/** The fill's sweep across a picked option: ease-in-out, so the travel reads instead of snapping to the end. */
const SWEEP = { duration: 0.38, ease: [0.6, 0, 0.3, 1] as const };
/** How long a picked option is shown (the sweep, then a short hold) before the step moves on. */
const HOLD_MS = 540;

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

/** The option's row layout, shared by its plain content and the fill layer drawn over it. */
const ROW = 'grid w-full grid-cols-[28px_minmax(0,1fr)] items-start gap-x-3 px-4 py-4 sm:grid-cols-[32px_minmax(0,1fr)] sm:px-5 sm:py-[18px]';
const LETTER = 'grid size-7 place-items-center font-mono text-[13px] leading-none sm:size-8 sm:text-sm';
const TEXT = 'max-w-[75ch] pt-[3px] text-base leading-snug sm:pt-1 sm:text-[17px]';

/**
 * An answer option as a full-width block: a mono letter in a square, then the text. Hover stays quiet (a muted tint,
 * the letter's square turns signal). A pick sweeps the signal fill across from the letter; the fill layer redraws the
 * content in white under the same clip, so the text turns white exactly at the fill's edge, and the letter becomes a
 * check. The layer stays for the hold and leaves with the step. Instant under reduced motion.
 */
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
  /** Picked: the fill sweeps in and stays until the step moves on. */
  held: boolean;
  disabled: boolean;
  onPick: () => void;
  buttonRef: (el: HTMLButtonElement | null) => void;
}) {
  const reduce = useReducedMotion();
  const quiet = !disabled && !held;
  return (
    <button
      ref={buttonRef}
      type="button"
      disabled={disabled}
      onClick={onPick}
      className={cn(
        'group relative block w-full overflow-hidden bg-card text-left outline-none transition-colors duration-150 disabled:cursor-not-allowed',
        quiet && 'hover:bg-muted',
      )}
    >
      <span className={ROW}>
        <span
          className={cn(
            LETTER,
            'border border-border text-faint transition-colors duration-150',
            quiet && 'group-hover:border-signal group-hover:bg-signal group-hover:text-signal-foreground',
          )}
        >
          {letter}
        </span>
        <span className={cn(TEXT, disabled && !held && 'opacity-50')}>{option.text}</span>
      </span>
      {/* Its own presence: the list's AnimatePresence has initial={false}, which would also skip this layer's sweep. */}
      <AnimatePresence>
        {held ? (
          <motion.span
            key="fill"
            aria-hidden
            initial={reduce ? false : { clipPath: 'inset(0 100% 0 0)' }}
            animate={{ clipPath: 'inset(0 0% 0 0)' }}
            transition={SWEEP}
            className={cn(ROW, 'absolute inset-0 bg-signal text-signal-foreground')}
          >
            <span className={cn(LETTER, 'border border-signal-foreground/50')}>
              <Check aria-hidden className="size-4" strokeWidth={2.25} />
            </span>
            <span className={TEXT}>{option.text}</span>
          </motion.span>
        ) : null}
      </AnimatePresence>
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-0 border-2 border-transparent',
          held ? 'group-focus-visible:border-signal-foreground' : 'group-focus-visible:border-ring',
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
  // The option showing its fill for HOLD_MS before pick() runs (and while the last answer saves); clicks are ignored
  // meanwhile.
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
      setHeld(null);
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
    // The last answer keeps its fill while the answers are saved.
    const last = phase.kind === 'second' && index + 1 >= questions.length;
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      if (!last) setHeld(null);
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
