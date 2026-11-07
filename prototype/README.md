# Prototype: product-to-article with DeepSeek
Requires Node 18+. No dependencies.
    export DEEPSEEK_API_KEY=your_key
    node generate.mjs products/laundry-ball.json "reusable laundry ball"
    node generate.mjs products/menstrual-cup.json "reusable menstrual cup australia"
Results land in `out/`. Product JSON files hold the full descriptions pulled from the dev store.
