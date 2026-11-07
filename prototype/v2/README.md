# Prototype v2: angle discovery, voice, audit
Pipeline (one command per product):
1. **Angles**: the AI proposes 6 informational article angles from the product data, avoiding the store's existing articles. Nothing is supplied by hand. The first is chosen by default; use `--angle 3` to pick another.
2. **Write**: article in the store voice (`voice/zwc-voice.md`), JSON output.
3. **Audit**: a separate call fact-checks every sentence against the product data; one automatic rewrite if it finds unsupported, risky or leaked wording.
4. **Checks**: code (not AI) checks title/meta length, link rules, headings, FAQ count, leaked wording, prices.

Run from this folder (Node 18+):

    export DEEPSEEK_API_KEY=your_key
    node run.mjs ../products/laundry-ball.json
    node run.mjs ../products/menstrual-cup.json

Results: `out/<product>/article.md` (read this), plus `1-angles.json`, `2-article.json`, `3-audit.json`, `4-checks.json`.

## v3 changes
- Angles carry `answerable_from_data` and `needs_outside_evidence`; the default pick is the most answerable angle (override with `--angle N`).
- Optional merchant answers: `inputs/answers/<handle>.json` ({"question": "answer"}). Treated as source of truth, like product data. This models the free plan asking the merchant.
- Audit then surgical fix (edit only the flagged sentences), up to 2 rounds, then re-audit. Never rewrites the whole article.
- Code checks flag Sources sections with no real sources, leaked wording, links, lengths. Similarity to your benchmark posts is reported for information only, and a judge step scores the new article against them (better/similar/worse).
- Final status: READY FOR MERCHANT APPROVAL or NEEDS REVIEW.

## v4: asking the merchant
After choosing an angle the tool checks whether the data has enough facts. If not, it asks up to 5 short questions in the terminal (Enter skips any). Answers are saved to `inputs/answers/<handle>.json` and treated as trusted product facts on every later run. Use `--no-ask` to skip. Delete the answers file to start fresh.
