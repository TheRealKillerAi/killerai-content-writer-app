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
