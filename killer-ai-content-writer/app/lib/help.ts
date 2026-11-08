export type HelpBlock = { h?: string; p?: string; list?: string[] };
export type HelpTopic = { slug: string; title: string; summary: string; blocks: HelpBlock[] };

export const HELP_TOPICS: HelpTopic[] = [
  {
    slug: "getting-started",
    title: "Getting started",
    summary: "From your first product to a published article.",
    blocks: [
      { p: "KillerAi Content Writer turns the facts in your store into search-friendly blog articles, and keeps your own facts in charge." },
      { h: "Before you begin", list: [
        "Open Settings and add a few lines about your store and who you sell to. This is what gives your articles their voice.",
        "Choose your blog, default author and whether articles go to Shopify as drafts or live.",
        "Make sure your products have good descriptions. The better the product page, the better the article.",
      ] },
      { h: "Writing your first article", list: [
        "Choose New article, then Product-focused.",
        "Pick a product. We suggest article topics based on what shoppers search for.",
        "Select a topic and press Continue.",
        "Add any extra details we ask about, or skip them. Then press Continue to write.",
        "Review the article, make any changes you need, and send it to your Shopify blog.",
      ] },
      { p: "Writing takes a minute or two. You can stay on the page while we work." },
    ],
  },
  {
    slug: "how-facts-work",
    title: "How we keep articles accurate",
    summary: "Why we ask questions and what happens to your answers.",
    blocks: [
      { p: "Your product information and the answers you give are the only source of facts about your products. We don't guess." },
      { h: "Why we ask questions", p: "When the product page doesn't cover something a shopper would want to know (sizes, materials, care steps), we ask. Answers are saved against the product and reused in later articles, so you only answer once." },
      { h: "If you don't know", p: "Tick \"I don't know\". We'll leave that topic out of the article rather than fill the gap. You can change your mind later using Ask again." },
      { h: "Checking every sentence", p: "After the article is written, each sentence is checked against your facts. Anything that goes beyond them is adjusted so the article stays accurate, and anything still worth a second look appears under Things to check." },
      { h: "What we pull in from Shopify", list: [
        "Title, description, type, vendor, tags and options.",
        "Product category.",
        "The weight recorded for each variant.",
        "Custom product fields you have set up, such as size or material.",
      ] },
      { p: "Prices are never included in articles." },
    ],
  },
  {
    slug: "writing-guides",
    title: "Writing a buying guide",
    summary: "Help shoppers choose between several products.",
    blocks: [
      { p: "A buying guide covers a group of your products as one routine, task or decision, and links to each of them." },
      { h: "Steps", list: [
        "Choose New article, then Buying guide.",
        "Select between 2 and 8 products that shoppers would choose between or use together.",
        "Find guide topics and select one. Topics are about the products as a group, such as a routine or how to choose.",
        "Answer any questions about each product, or skip them.",
        "Write the guide, then review and send it as usual.",
      ] },
      { h: "Good to know", list: [
        "Products are compared only on facts we have for each of them.",
        "The guide links to every product once.",
        "If the topics look too narrow, use Clear this list and start again.",
      ] },
    ],
  },
  {
    slug: "editing-and-sending",
    title: "Editing and sending to Shopify",
    summary: "The editor, the score, and what happens when you send.",
    blocks: [
      { h: "The editor", list: [
        "Edit shows everything you can change. Preview shows roughly how the article will look.",
        "The body works like Shopify's editor. Use Show HTML to see and edit the code.",
        "When you change something, a Save bar appears. Save keeps your changes; Discard puts things back.",
      ] },
      { h: "Article score", p: "The score at the top right updates as you edit. SEO covers things like your search title and description, headings, image text and links. AI readiness covers how easy the article is for AI search to understand and quote. Each list shows what to improve." },
      { h: "Organization", p: "Author, blog, tags and theme template start from your Settings. Change them here if this article needs something different." },
      { h: "Sending", list: [
        "Send as a draft to review it in Shopify first, or send it live.",
        "After sending, use Update in Shopify to apply later changes.",
        "Your theme controls the final look. Use Preview in Shopify on the draft to see the exact result.",
      ] },
    ],
  },
  {
    slug: "email-and-social",
    title: "Email and social copy",
    summary: "Ready-made copy that links to your article.",
    blocks: [
      { p: "Each article comes with an email subject and body and a social post. The link points to your article using the blog and URL handle you have set, and changes if you change either." },
      { list: [
        "Linked words appear underlined. The link only works once the article is published.",
        "Copy keeps hyperlinks when you paste into most email tools.",
        "Many social platforms show plain text only. For those, paste the full link after your sentence.",
      ] },
    ],
  },
  {
    slug: "better-results",
    title: "Getting better results",
    summary: "Extra instructions, and how to shape the writing for your store.",
    blocks: [
      { p: "The writing follows some default style rules. You can add your own extra instructions in Settings under Advanced, in Extra instructions for writing (and for ideas). Your instructions take priority over our default style rules." },
      { p: "Your product facts still come first. Extra instructions can change style, structure and focus, but they can't override the facts or switch off the checks." },
      { h: "Tips for good instructions", list: [
        "Be specific and keep each instruction short.",
        "Describe what you want, not only what to avoid.",
        "Give a short example of the wording you like.",
        "Add instructions when you notice the same thing needing a fix in several articles.",
      ] },
      { h: "Examples (replace with your own wording)", list: [
        "When an article mentions disposal or recycling, always say: Please check your local council's rules for recycling.",
        "Finish every how-to with one sentence inviting readers to contact us with questions.",
        "Write steps as a numbered list, one action per step.",
        "Never compare our products with other brands.",
        "Always refer to customers as shoppers, not buyers.",
      ] },
      { h: "A note on plans", p: "Faster, lower-cost writing models sometimes need clearer instructions to match your store's style. If you see the same issue repeatedly, a short extra instruction usually fixes it." },
    ],
  },
  {
    slug: "troubleshooting",
    title: "Troubleshooting",
    summary: "Common questions and what to try.",
    blocks: [
      { h: "My article says Needs review", p: "That means a few things are worth checking, for example a sentence we weren't sure about. Open the article and look under Things to check." },
      { h: "The article didn't write", p: "Press back and try again. If it keeps happening, wait a minute and retry; our writing service may be busy." },
      { h: "A fact is wrong or missing", p: "Edit the sentence directly, or add the fact to the product through Ask again so future articles have it." },
      { h: "There's no image", p: "Articles use your product photos. Choose one under Featured image and add a short description for it." },
      { h: "I changed the link text in my email copy and it vanished", p: "Press Discard changes to restore the original, or select the words again and re-link them." },
    ],
  },
];
