'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { profileSchema, quizResponseSchema, type QuizAnswerInput, type QuizQuestionDto, type Taxonomy } from '@attn/shared';
import { BrowserApiError, browserJson } from '@/lib/browser-api';
import { FocusPicker } from './focus-picker';
import { QuizRunner } from './quiz-runner';

const primary =
  'rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg disabled:cursor-not-allowed disabled:opacity-50';
const secondary = 'rounded-md border border-line px-4 py-2 text-sm text-muted hover:text-fg disabled:opacity-50';

export function OnboardingFlow({
  taxonomy,
  role,
  initialFocus,
}: {
  taxonomy: Taxonomy;
  role: string;
  initialFocus: string[];
}) {
  const router = useRouter();
  const [focus, setFocus] = useState<string[]>(initialFocus);
  const [questions, setQuestions] = useState<QuizQuestionDto[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const skillNames: Record<string, string> = {};
  for (const d of taxonomy.domains) for (const s of d.skills) skillNames[s.id] = s.name;

  function done() {
    router.push('/profile');
    router.refresh();
  }

  async function post(answers: QuizAnswerInput[]) {
    await browserJson('POST', '/onboarding', profileSchema, { focus, answers });
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof BrowserApiError ? e.message : 'Something went wrong. Please try again.');
      setBusy(false);
    }
  }

  const cont = () =>
    run(async () => {
      const quiz = await browserJson('GET', `/quiz?skills=${encodeURIComponent(focus.join(','))}`, quizResponseSchema);
      if (quiz.questions.length === 0) {
        await post([]);
        done();
        return;
      }
      setQuestions(quiz.questions);
      setBusy(false);
    });

  const skip = () =>
    run(async () => {
      await post([]);
      done();
    });

  if (questions) {
    return <QuizRunner questions={questions} focus={focus} skillNames={skillNames} onSubmitted={done} />;
  }

  return (
    <div className="space-y-6">
      <FocusPicker taxonomy={taxonomy} role={role} value={focus} onChange={setFocus} />
      {error ? (
        <p role="alert" className="rounded-lg border border-line bg-accent-soft px-4 py-3 text-sm">
          {error}
        </p>
      ) : null}
      <div className="flex gap-3">
        <button type="button" className={primary} disabled={busy || focus.length < 1 || focus.length > 5} onClick={() => void cont()}>
          Continue
        </button>
        <button type="button" className={secondary} disabled={busy || focus.length < 1} onClick={() => void skip()}>
          Skip quiz for now
        </button>
      </div>
    </div>
  );
}
