'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  MAX_FOCUS,
  profileSchema,
  quizResponseSchema,
  skillNameMap,
  type QuizAnswerInput,
  type QuizQuestionDto,
  type Taxonomy,
} from '@attn/shared';
import { BrowserApiError, browserJson } from '@/lib/browser-api';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FocusPicker } from './focus-picker';
import { FocusTray } from './focus-tray';
import { QuizRunner } from './quiz-runner';

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

  const skillNames = useMemo(() => skillNameMap(taxonomy), [taxonomy]);

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
    return (
      <QuizRunner
        questions={questions}
        focus={focus}
        skillNames={skillNames}
        onSubmitted={done}
        onExit={() => setQuestions(null)}
      />
    );
  }

  const actions = (
    <>
      <Button
        type="button"
        className="group/continue"
        disabled={busy || focus.length < 1 || focus.length > MAX_FOCUS}
        onClick={() => void cont()}
      >
        Continue
        <ArrowRight aria-hidden className="transition-transform duration-200 group-hover/continue:translate-x-0.5 motion-reduce:transition-none" />
      </Button>
      <Button type="button" variant="outline" disabled={busy || focus.length < 1} onClick={() => void skip()}>
        Skip quiz for now
      </Button>
    </>
  );

  return (
    <div className="space-y-10">
      <FocusPicker taxonomy={taxonomy} role={role} value={focus} onChange={setFocus} />
      <FocusTray items={focus} names={skillNames} onChange={setFocus} actions={actions} error={error} />
    </div>
  );
}
