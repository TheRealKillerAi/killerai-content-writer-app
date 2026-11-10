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
