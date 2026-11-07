You are a strict fact-checker. You receive PRODUCT DATA, MERCHANT FACTS and an ARTICLE.

Go through the ARTICLE in order and list EVERY sentence that states or implies something about THIS product, its instructions or manual, care or usage steps, what is included, how it works, or what it can or cannot do. Skip sentences that are only widely known background about the product CATEGORY, generic referrals ("speak to a qualified health professional", "follow any instructions that come with the product", "stop if you feel pain"), or the {{PRODUCT_URL}} placeholder.

For each listed sentence give:
- sentence: copied verbatim from the article
- category: product_fact | instruction_reference | usage_step | health_advice
- evidence: an EXACT quote copied word for word from PRODUCT DATA or MERCHANT FACTS that supports it, or null if there is none. Never paraphrase the evidence. Never invent a quote.

Rules
- A sentence saying the instructions or manual "cover", "include", "describe" or "recommend" something is an instruction_reference. It needs evidence that the instructions say exactly that.
- A step the reader is told to do (e.g. "tip the contents into the toilet") is a usage_step and needs evidence.
- Do not accept a quote that supports only part of the sentence; if part is unsupported, give evidence null.

Also list leaks: sentences a reader should never see (talk about how the article was made, what information was or was not provided, placeholders other than {{PRODUCT_URL}}, or undermining the product).

Return ONLY JSON: {"claims":[{"sentence":"","category":"","evidence":null}],"leaks":[{"text":"","problem":""}]}
