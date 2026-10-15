import { describe, expect, it } from 'vitest';
import { change, clear, commit, edit, filterKey, initFilterState, syncProps, type FilterValues } from './filter-state';

const empty: FilterValues = { skill: [], q: '' };
const start = (v: FilterValues = empty) => initFilterState(v);

describe('filter bar state', () => {
  it('two quick toggles are both kept (the second is built from pending, not from stale props)', () => {
    const a = change(start(), { skill: ['a'] });
    const b = change(a.state, { skill: [...a.state.pending.skill, 'b'] });
    expect(b.state.pending.skill).toEqual(['a', 'b']);
    expect(a.query).toBe('?skill=a');
    expect(b.query).toBe('?skill=a&skill=b');
  });

  it('typing during a pending navigation is kept when the props catch up with the earlier search', () => {
    let s = edit(start(), { q: 'rag' });
    const c = commit(s); // debounce fired: replace(?q=rag)
    s = edit(c.state, { q: 'rag p' }); // user keeps typing while it is in flight
    s = syncProps(s, { skill: [], q: 'rag' }); // the server answers for ?q=rag
    expect(s.pending.q).toBe('rag p');
    expect(commit(s).query).toBe('?q=rag+p'); // and the next debounce still pushes it
  });

  it('props that arrive for an earlier of several writes do not revert the controls', () => {
    const a = change(start(), { skill: ['a'] });
    const b = change(a.state, { skill: ['a', 'b'] });
    const s = syncProps(b.state, { skill: ['a'], q: '' });
    expect(s.pending.skill).toEqual(['a', 'b']);
    expect(syncProps(s, { skill: ['a', 'b'], q: '' }).pushed).toEqual([]);
  });

  it('clear with an unsent search does not bring values back when the debounce would have fired', () => {
    let s = change(start({ skill: ['a'], q: '' }), {}).state;
    s = edit(s, { q: 'agents' }); // typed, not yet in the URL
    const c = clear(s);
    expect(c.query).toBe('');
    expect(c.state.pending).toEqual({ skill: [], q: '', source: undefined, from: undefined, to: undefined });
    // the component cancels its timer; even if a commit ran now it would push nothing new
    expect(commit(c.state).query).toBeNull();
    expect(commit(syncProps(c.state, { skill: ['a'], q: '' })).query).toBeNull();
  });

  it('back/forward (a URL this bar did not write) re-syncs the controls', () => {
    const a = change(start(), { skill: ['a'] });
    const s = syncProps(a.state, { skill: ['x', 'y'], q: 'old' });
    expect(s.pending).toEqual({ skill: ['x', 'y'], q: 'old' });
    expect(s.pushed).toEqual([]);
    expect(syncProps(s, { skill: ['x', 'y'], q: 'old' })).toBe(s);
  });

  it('commit skips a URL that is already current, and trims the search text', () => {
    const s = start({ skill: [], q: 'rag' });
    expect(commit(s).query).toBeNull();
    expect(commit(edit(s, { q: ' rag ' })).query).toBeNull();
    expect(filterKey({ skill: [], q: ' rag ' })).toBe('?q=rag');
  });
});
