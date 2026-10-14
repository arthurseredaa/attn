import { BadRequestException, ConflictException, Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';
import {
  FocusError,
  NotOnboardedError,
  QuizAnswerError,
  assertValidFocus,
  isOnboarded,
  presentQuiz,
  roleSkillIds,
  saveOnboarding,
  scoreQuiz,
  setFocus,
  type Db,
} from '@attn/core';
import type { Config, FocusBody, OnboardingBody, Profile, Quiz, QuizResponse, Taxonomy } from '@attn/shared';
import type { AuthUser } from '../auth/session';
import { ProfileService } from '../profile/profile.service';
import { APP_CONFIG, DB, QUIZ, TAXONOMY } from '../tokens';

function mapDomainError(e: unknown): unknown {
  if (e instanceof FocusError || e instanceof QuizAnswerError) return new UnprocessableEntityException(e.message);
  if (e instanceof NotOnboardedError) return new ConflictException('Complete onboarding first');
  return e;
}

@Injectable()
export class OnboardingService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(TAXONOMY) private readonly taxonomy: Taxonomy,
    @Inject(QUIZ) private readonly quizBank: Quiz,
    @Inject(APP_CONFIG) private readonly config: Config,
    @Inject(ProfileService) private readonly profiles: ProfileService,
  ) {}

  quiz(user: AuthUser, skills: string[]): QuizResponse {
    const role = roleSkillIds(this.taxonomy, user.role);
    const unknown = skills.find((s) => !role.includes(s));
    if (unknown) throw new BadRequestException(`Unknown skill: ${unknown}`);
    return presentQuiz(this.quizBank, skills);
  }

  async submit(user: AuthUser, body: OnboardingBody): Promise<Profile> {
    const role = roleSkillIds(this.taxonomy, user.role);
    try {
      if (body.focus) assertValidFocus(body.focus, role);
      else if (!(await isOnboarded(this.db, user.id))) throw new UnprocessableEntityException('Pick a focus first');
      const results = scoreQuiz(this.quizBank, body.answers, this.config.uncertain_spread);
      const outside = results.find((r) => !role.includes(r.skillId));
      if (outside) throw new UnprocessableEntityException(`Skill not in your role: ${outside.skillId}`);
      await saveOnboarding(this.db, {
        userId: user.id,
        roleSkillIds: role,
        focus: body.focus,
        results,
        answers: body.answers,
        quizVersion: this.quizBank.version,
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
