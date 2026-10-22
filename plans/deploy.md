# Deploy TODO

- Plan deploy from scratch (the old Hetzner draft was dropped on 2026-10-22).
- Server secrets: `JEV_API_KEY`, `ANTHROPIC_API_KEY`, `LABEL_MODEL=typesafe-ai/jev+claude-haiku-5-5`, GitHub OAuth.
- The API's daily job collects and labels (`schedule_cron`, `label_batch: 100`); labeling is about $0.001 per article.
- Run `pnpm attn migrate` on deploy (the local DB once missed a migration: `source_state.feed_url`).
- Nightly DB backups off-site, with a restore drill.
- Move the label-experiment archive `.cache/fable-2026-10-21/` (DB dumps, Haiku/Jev/Fable labels, eval reports,
  about 1 MB, local only today) into the backup storage.
