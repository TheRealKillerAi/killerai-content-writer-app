# AI Refresh: Stage 2 as built (10 Nov 2026)

Companion to `claude/refresh-mode-design.md` (the design and decisions). That file still says Stage 2 is next; this one records what was actually built. They will be merged when the plan doc is next updated.

## Stage 2 as built (10 Nov 2026, commits a3c9dc6 and ef7e731; deployed, migration applied)
Review and update **one post at a time**. No AI is used yet in this stage: every change is worked out by code, so it is fast, free and predictable.

- **Where**: each row on the AI Refresh list has a **Review** button, opening `/app/refresh/<article id>`.
- **Changes list** (only one kind of change so far): for a link to a product, collection or post that no longer exists (rules `dead_product`, `dead_collection`, `dead_post`), shows the sentence **before** (linked words underlined) and **after** (same words, no link), with **Accept** and **Ignore**, plus Accept all and Ignore all. Undecided changes are left as they are.
- **Worth a look (never changed)**: out-of-stock product links, past years and prices appear as notes with the text around them. A year in the title, search title or search description, or one that reads like a freshness claim ("best bags of 2023"), is described as one that can make the post look dated; one that reads like history is described as probably fine. Prices say "check it still matches the product page".
- **Before and after**: words, SEO score and AI readiness, each with the full check list marked pass or fail before and after ("Now passes" / "Now fails"). Recalculated live as changes are accepted, in the browser, with the same scorer as the article page. Keyword checks are left out, as on the list.
- **Update this post in Shopify (N changes)**: disabled until a change is accepted. Everything is worked out again from the post as it is *now* when the button is pressed. A link is only touched if it still points where it did when proposed, so a post edited in the meantime is never blindly overwritten. Only the **body** is sent in `articleUpdate`: the URL handle, published date, author, image, tags and search fields are never touched.
- **Audit trail**: tables `RefreshRun` (one per update: article, who, when, words/SEO/AI before and after, old and new body) and `RefreshChange` (each proposed change with accepted or ignored). Shown as **Refresh history** on the review page.
- **Undo for 30 days**: restores the old body in one click, but only if the post has not been edited since (otherwise it says so rather than losing the edits). The saved bodies are cleared after 31 days by the daily cron. History rows stay.
- **Rules and control**: `app/lib/refreshRules.ts` is the single list of rules. The **"How AI Refresh decides"** panel (on the list and review pages) shows every rule and its current setting. **Settings > AI Refresh** has a switch per rule: dead-link rules are *Suggest a fix / Point it out only / Off*; out-of-stock, years and prices are *Point it out only / Off*. Turning a rule off also removes it from the list's "what looks out of date". Stage 1 weights for years and prices were lowered from 3 to 1 each.
- **Protected posts**: "Never refresh this post" and "Never refresh anything in <blog>" on the review page. Protected posts are left out of the list (the page says how many), and listed under "Never refreshed" with "Allow again".
- **Privacy**: shop redact now also deletes `RefreshRun`, `RefreshChange` and `RefreshProtected`.

**Not in stage 2 (moved to stage 3):** the "Extra instructions for AI Refresh" box. It changes what the AI *writes*, and stage 2 has no AI, so a box that does nothing would mislead. It arrives with the first AI proposals.

**To verify on the live store:** open Review on a real post with a dead link, accept one change, update, check the post in Shopify (link gone, words kept, URL and published date unchanged), then Undo. This is also the first test of `articleUpdate` on a post written by hand.

## Added after first live test (10 Nov 2026, commits a33b52a and abcfb50)
Owner confirmed on the live store that dead-link removal works and the changes show on the store.
- **Undo after later edits**: if the post was edited after the update, the history row shows **Restore backup…**. A confirm step says it puts the post back as it was before the update and **overwrites the later edits**. Nothing is lost without the merchant agreeing. (Owner request.)
- **Replace a dead link**: each change offers **Replace with a product…**, **…a collection** (Shopify's own picker) or **…a blog post** (dropdown of published posts, because the picker has no posts). Chosen target shows in the After box and in history (`replace_link`). Only paths on the store (`/products/`, `/collections/`, `/blogs/`, `/pages/`) are accepted on the server. Not yet offered: pages and policies, as in the theme editor's link picker.
- **Where the old link pointed**: each change says what the dead link pointed to in plain words (for example the product "old bag" at /products/old-bag), to help choose a replacement.
- **Expectation note**: the page and the update/undo messages say Shopify can take a few minutes to show a change on the store.

## Stage 3 design additions: outdated dates and facts (agreed 10 Nov 2026)
The fix for an old year is **updated wording, not changing the number**. Examples from the owner's plastic-free posts: "National Plastics Plan (2021)" has been superseded and could be reworded to the newer plan; "tackle the plastic pollution problem by 2025" refers to a promise that has moved; "EPS out by 2022" is probably right but should be checked against when it was actually banned.

Three steps, one sentence at a time, in the "Worth a look" area:
1. **Fact check this** (button on a flagged year or date claim). Searches the web, compares what the post says (a date or a prediction) with what actually happened, and reports: still correct, changed, or couldn't verify. Shows its sources. Changes nothing.
2. **Hint box** (optional) per flagged line, for example "now the 2025 plan, replace the 2021 reference". Steers the rewrite.
3. **Suggest a rewrite**: AI proposes new wording for that sentence only, from the hint and the checked facts; shown as a normal before/after with Accept and Ignore. Goes through the same audit as everything else.

**Source rules (owner, 10 Nov): only reliable sources, and always show them so the merchant can judge.**
- Allowed: government and regulator sites, standards bodies, universities and research institutes, established news organisations, industry bodies, and a company's own official pages.
- Never used as a source: social media (Instagram, X, Facebook, TikTok, Pinterest, Reddit, YouTube and similar), forums, anonymous or content-farm blogs, and user-edited wikis on their own.
- Every result lists its sources: site name, type (government, news, industry body and so on), the date of the page, and a link. The merchant decides whether to trust them.
- Facts from outside sources are used only if a listed source supports them. If nothing reliable confirms a claim, it says "couldn't verify, check this one yourself" and **no rewrite is offered**.
- The "Extra instructions for AI Refresh" box arrives in this stage.

## Stage 3 part 1 as shipped (10 Nov 2026, commits 16d3514, efba2f6): note + reword only; web fact check parked
**Decision (owner, 10 Nov): don't add a feature that costs us per click.** The web fact check works (tested with stubs: social media removed, invented quotes rejected, rewrite offered only when a trusted source backs it) but is **switched off**: it only appears if `TAVILY_API_KEY` is set in Vercel, which it is not. No cost is incurred. Also decided: **no "paste a link" box**, because it asks the merchant to do more work.

What merchants get now, for a sentence in the body that mentions a past year (under "Worth a look"):
- **Note for the AI (optional)**: what is true now, in the merchant's words.
- **Suggest a rewording**: one small AI call (a fraction of a cent) that rewrites only that sentence. Uses only the note (and the sentence); any number or year in the new sentence must come from the original sentence or the note, otherwise it is dropped. Shown as Before/After with Accept or Ignore; counted in the scores; saved in history (`rewrite_sentence`); undoable. Sentences containing a link or formatting can't be reworded automatically (edit in Shopify).
- **Settings > AI Refresh > Extra instructions for AI Refresh** (style only, cannot override fact rules).

Parked, code in place: `app/lib/factcheck.server.ts` and `app/lib/sources.ts` (source rules above). To revive: set `TAVILY_API_KEY`. Cost with the current settings is about 3 cents a check (two advanced searches at $0.008 per credit, 2 credits each) plus AI calls; one basic search would be about 1 cent. Free allowance is 1,000 credits a month. Cheaper search vendors quote around $1 to $5 per 1,000 searches (vendor claims, unverified).
**Idea for a higher plan:** a "Fact check" button that tells the merchant it uses one check from their plan, and asks them to confirm, so the cost is visible to them and counted in the usage meter. Decide when plans and margins are settled.
