# tiny-text-watermark

A tiny keyed text watermark and detector in TypeScript.

On October 5, 2026, OpenAI [announced](https://openai.com/index/eu-text-provenance/) opt-in text watermarking in its API and an invisible watermark for eligible ChatGPT and Codex output in the EU. Its watermark, textGrain, hides a statistical signal in which words get picked.

This repo is a small, textbook version of that family of ideas, so you can see how it behaves:

- **Keyed sampling.** A random number from HMAC-SHA256(key, last 3 words, candidate) replaces the model's die. Picking the largest `r ^ (1 / p)` keeps the model's odds.
- **A detector** that needs only the text and the key. It adds up `-log(1 - r)` and compares the total to a Gamma(n, 1) distribution.
- **An edit attack** that swaps a share of words for synonyms.

This is not textGrain. There is no optimal transport, no entropy budget and no real tokenizer. The "model" is a mock with a seven-slot vocabulary, and every number it prints comes from this toy.

## Run it

```bash
npm install
npx tsx watermark.ts
```

No API key. No model. Node 18 or newer.

## Output

```text
One passage, 21 words

watermarked:   Our quick service checked the test today. Our small model checked the query safely. This careful service checked the test today.
  -> watermark detected (p = 9.1e-6)
unwatermarked: This small worker updated every test quietly. That simple system repaired each bug safely. The small service fixed one file quickly.
  -> no watermark detected (p = 0.99). This does not prove a human wrote it.
wrong key:     no watermark detected (p = 0.29). This does not prove a human wrote it.

Detection rate over 500 passages, 1% false positive target

                                      14 words  28 words  56 words
no watermark (false positives)            1.0%      0.6%      1.0%
watermarked, untouched                   95.6%     98.6%     99.4%
watermarked, 10% of words swapped        62.4%     81.0%     88.6%
watermarked, 25% of words swapped        25.8%     32.6%     43.2%
watermarked, rigid text (math-like)      18.4%     21.8%     18.2%
```

## Read the write-up

- Substack: SUBSTACK_URL
- DEV: https://dev.to/bobbyhalljr/openai-started-watermarking-chatgpt-text-build-a-tiny-text-watermark-in-typescript-5ak0

## License

MIT
