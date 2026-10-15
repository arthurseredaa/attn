'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { profileSchema, type QuizAnswerInput, type QuizQuestionDto } from '@attn/shared';
import { BrowserApiError, browserJson } from '@/lib/browser-api';

type Phase = { kind: 'first' } | { kind: 'second'; first: number };

const optionBtn =
  'w-full rounded-lg border border-border bg-card px-4 py-3 text-left text-sm hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50';
const ghostBtn = 'rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50';

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
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>({ kind: 'first' });
  const [answers, setAnswers] = useState<QuizAnswerInput[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<QuizAnswerInput[] | null>(null);

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

  const atStart = phase.kind === 'first' && index === 0;

  function back() {
    if (busy) return;
    if (phase.kind === 'second') setPhase({ kind: 'first' });
    else if (index > 0) {
      setAnswers(answers.slice(0, -1));
      setIndex(index - 1);
      setPhase({ kind: 'first' });
    } else onExit?.();
  }

  const options = phase.kind === 'first' ? question.options : question.options.filter((o) => o.id !== phase.first);
  const canBack = !atStart || onExit !== undefined;

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">
          Question {index + 1} of {questions.length}
        </p>
        <h2 className="text-lg font-semibold">{skillNames[question.skillId] ?? question.skillId}</h2>
      </div>
      <p>{question.situation}</p>
      <p className="text-sm font-medium">
        {phase.kind === 'first' ? 'What would you do?' : "If that option weren't there, what would you do?"}
      </p>
      <div className="space-y-2">
        {options.map((o) => (
          <button key={o.id} type="button" className={optionBtn} disabled={busy} onClick={() => pick(o.id)}>
            {o.text}
          </button>
        ))}
      </div>
      {error ? (
        <div role="alert" className="space-y-2 rounded-lg border border-border bg-primary/10 px-4 py-3 text-sm">
          <p>{error}</p>
          <button type="button" className={ghostBtn} disabled={busy} onClick={() => pending && void submit(pending)}>
            Try again
          </button>
        </div>
      ) : null}
      <button type="button" className={ghostBtn} disabled={busy || !canBack} onClick={back}>
        {atStart && onExit ? 'Back to focus' : 'Back'}
      </button>
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
