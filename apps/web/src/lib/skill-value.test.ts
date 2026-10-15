import { describe, expect, it } from 'vitest';
import type { Profile, ProfileSkill } from '@attn/shared';
import { domainPoints, focusPoints, levelLabelFor, skillValue } from './skill-value';

const labels = new Map([
  [0, 'Zero'],
  [1, 'One'],
  [2, 'Two'],
  [3, 'Three'],
  [4, 'Four'],
]);

function skill(over: Partial<ProfileSkill>): ProfileSkill {
  return {
    id: 's',
    name: 'S',
    description: '',
    level: 2,
    effectiveLevel: 2,
    assessed: true,
    quizzed: true,
    uncertain: false,
    points: 0,
    pointsNeeded: 10,
    focusRank: null,
    ...over,
  };
}

describe('skillValue', () => {
  it('adds the progress to the next level', () => {
    expect(skillValue(skill({ level: 2, points: 5, pointsNeeded: 10 }))).toBe(2.5);
  });
  it('treats an unassessed skill as level 1', () => {
    expect(skillValue(skill({ level: null, points: 0 }))).toBe(1);
  });
  it('keeps full progress below the next whole level', () => {
    expect(skillValue(skill({ level: 1, points: 30, pointsNeeded: 10 }))).toBeCloseTo(1.99);
  });
  it('is 4 at the top level', () => {
    expect(skillValue(skill({ level: 4, points: 7, pointsNeeded: null }))).toBe(4);
  });
});

describe('levelLabelFor', () => {
  it('uses the whole level the value sits on', () => {
    expect(levelLabelFor(2.7, labels)).toBe('Two');
    expect(levelLabelFor(4, labels)).toBe('Four');
    expect(levelLabelFor(0, labels)).toBe('Zero');
  });
});

describe('radar points', () => {
  const domains: Profile['domains'] = [
    {
      id: 'a',
      name: 'A',
      skills: [
        skill({ id: 'a1', name: 'A1', level: 3, points: 0, focusRank: 2 }),
        skill({ id: 'a2', name: 'A2', level: null, points: 0 }),
      ],
    },
    { id: 'b', name: 'B', skills: [skill({ id: 'b1', name: 'B1', level: 0, points: 5, focusRank: 1 })] },
    { id: 'c', name: 'C', skills: [skill({ id: 'c1', name: 'C1', level: 4, pointsNeeded: null })] },
  ];

  it('averages each domain and marks the ones holding a focus skill', () => {
    expect(domainPoints(domains, labels)).toEqual([
      { id: 'a', name: 'A', value: 2, levelLabel: 'Two', focused: true },
      { id: 'b', name: 'B', value: 0.5, levelLabel: 'Zero', focused: true },
      { id: 'c', name: 'C', value: 4, levelLabel: 'Four', focused: false },
    ]);
  });

  it('lists the focus skills in rank order', () => {
    expect(focusPoints(domains, labels).map((p) => [p.id, p.value])).toEqual([
      ['b1', 0.5],
      ['a1', 3],
    ]);
  });
});
