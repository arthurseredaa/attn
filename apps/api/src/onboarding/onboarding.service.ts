import { ConflictException, Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';
import {
  FocusBusyError,
  FocusError,
  NotOnboardedError,
  QuizAnswerError,
  assertValidFocus,
  presentQuiz,
  roleSkillIds,
  saveOnboarding,
  scoreQuiz,
  setFocus,
  type Db,
} from '@attn/core';
import type { Config, FocusBody, OnboardingBody, Profile, Quiz, QuizResponse, Taxonomy } from '@attn/shared';
import type { AuthUser } from '../auth/session';
import { CodedHttpException } from '../common/coded-http.exception';
import { AppValidationError } from '../common/zod';
import { ProfileService } from '../profile/profile.service';
import { APP_CONFIG, DB, QUIZ, TAXONOMY } from '../tokens';

function mapDomainError(e: unknown): unknown {
  if (e instanceof FocusError || e instanceof QuizAnswerError) return new UnprocessableEntityException(e.message);
  if (e instanceof NotOnboardedError) return new ConflictException('Complete onboarding first');
  if (e instanceof FocusBusyError) return new CodedHttpException(503, 'busy', e.message);
  return e;
}

/** A role without `data/quiz/<role>.yml` has no questions: every skill is reported unavailable. */
const NO_BANK: Quiz = { version: 0, questions: [] };

@Injectable()
export class OnboardingService {

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(TAXONOMY) private readonly taxonomy: Taxonomy,
    @Inject(QUIZ) private readonly banks: ReadonlyMap<string, Quiz>,
    @Inject(APP_CONFIG) private readonly config: Config,
    @Inject(ProfileService) private readonly profiles: ProfileService,
  ) {}

  private bankFor(role: string): Quiz {
    const bank = this.banks.get(role);
    if (bank) return bank;
    return NO_BANK;
  }

  quiz(user: AuthUser, skills: string[]): QuizResponse {
    const role = roleSkillIds(this.taxonomy, user.role);
    const unknown = skills.find((s) => !role.includes(s));
    if (unknown) throw new AppValidationError(`Unknown skill: ${unknown}`);
    return presentQuiz(this.bankFor(user.role), skills);
  }

  async submit(user: AuthUser, body: OnboardingBody): Promise<Profile> {
    const role = roleSkillIds(this.taxonomy, user.role);
    try {
      if (body.focus) assertValidFocus(body.focus, role);
      const bank = this.bankFor(user.role);
      const results = scoreQuiz(bank, body.answers, this.config.uncertain_spread);
      const outside = results.find((r) => !role.includes(r.skillId));
      if (outside) throw new UnprocessableEntityException(`Skill not in your role: ${outside.skillId}`);
      await saveOnboarding(this.db, {
        userId: user.id,
        roleSkillIds: role,
        focus: body.focus,
        results,
        answers: body.answers,
        quizVersion: bank.version,
      });
    } catch (e) {
      throw mapDomainError(e);
    }
    return this.profiles.get(user);
  }

  async changeFocus(user: AuthUser, body: FocusBody): Promise<Profile> {
    try {
      await setFocus(this.db, user.id, body.focus, roleSkillIds(this.taxonomy, user.role));
    } catch (e) {
      throw mapDomainError(e);
    }
    return this.profiles.get(user);
  }
}
