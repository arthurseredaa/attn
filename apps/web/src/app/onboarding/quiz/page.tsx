import Link from 'next/link';
import { redirect } from 'next/navigation';
import { quizQuerySchema, skillNameMap } from '@attn/shared';
import { QuizRetake } from '@/components/onboarding/quiz-runner';
import { Button } from '@/components/ui/button';
import { ApiError, getQuiz, getTaxonomy } from '@/lib/api';
import { requireProfile, signedIn } from '@/lib/guards';

export const metadata = { title: 'Quiz | ATTN' };

export default async function QuizPage({ searchParams }: { searchParams: Promise<{ skills?: string | string[] }> }) {
  await requireProfile();
  const raw = (await searchParams).skills;
  const parsed = quizQuerySchema.safeParse({ skills: Array.isArray(raw) ? raw[0] : raw });
  if (!parsed.success) redirect('/profile');

  let quiz;
  try {
    quiz = await signedIn(getQuiz(parsed.data.skills));
  } catch (e) {
    if (e instanceof ApiError && e.status === 400) redirect('/profile');
    throw e;
  }

  const skillNames = skillNameMap(await getTaxonomy());

  return (
    <div className="space-y-8">
      <h1 className="text-[36px] leading-[1.05] font-semibold tracking-[-0.035em] sm:text-[44px] lg:text-[52px]">
        Quiz
      </h1>
      {quiz.questions.length === 0 ? (
        <div className="space-y-4">
          <p className="text-muted-foreground">No quiz is available for these skills yet.</p>
          <Button asChild variant="outline" className="px-3.5">
            <Link href="/profile">Back to your profile</Link>
          </Button>
        </div>
      ) : (
        <QuizRetake questions={quiz.questions} skillNames={skillNames} />
      )}
    </div>
  );
}
