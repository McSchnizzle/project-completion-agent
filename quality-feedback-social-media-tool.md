# Quality Feedback for Social Media Tool

## Problem Identified
The generated LinkedIn posts are technically correct but "AI slop" - no one would actually engage with them.

## Specific Issues Found

| Issue | Current Behavior | What Good Looks Like |
|-------|------------------|----------------------|
| **Length** | 250-300 words | 50-150 words max |
| **Opening** | Generic statements ("Testing technology has reached an inflection point...") | Hooks that grab attention ("I deleted 90% of our test suite. Best decision I ever made.") |
| **Tone** | Corporate whitepaper: "revolutionizing", "unprecedented", "reshaping our industry" | Conversational, authentic, sounds like a real person |
| **Structure** | Bullet points, "First, Second, Third" | Flows like a conversation, not a report |
| **Questions** | Generic CTAs ("How is your organization adapting...?") | Specific, answerable questions that invite real responses |
| **Specificity** | Vague metrics ("40% reduction") | Stories with context, named examples, proof |
| **Hashtags** | 5-6 hashtags at end | 2-3 max, or none |
| **Voice** | Could be written by anyone/anything | Personality, vulnerability, contrarian takes |

## Recommended Improvements

### 1. Rubric Scoring
Add automatic quality checks before presenting to user:
- [ ] Length < 150 words (or configurable per platform)
- [ ] First sentence is a hook (question, bold claim, story opener)
- [ ] No more than 3 hashtags
- [ ] No corporate buzzwords from blocklist ("revolutionizing", "unprecedented", "game-changing", "inflection point", etc.)
- [ ] Contains at least one specific example, number, or story
- [ ] Ends with engaging (not generic) question or CTA

### 2. Reference Examples
- Allow user to provide 5-10 "gold standard" posts that represent desired quality
- Agent compares generated output against these examples
- Flag when output deviates significantly from reference style/tone/length

### 3. LLM-as-Judge Pre-Check
Before showing posts to user, run a separate LLM critique:
- "Would a LinkedIn power user engage with this? Score 1-10 and explain why."
- "Does this sound like AI wrote it? What gives it away?"
- "What's the single biggest improvement that would make this more engaging?"

Only show posts to user that pass a minimum quality threshold, or show the critique alongside the post.

### 4. Existing Controls
- Sliders for "energetic" and "shorter" already exist
- Human-in-the-loop review already exists
- These are good but insufficient alone - quality check should happen BEFORE user sees output

## Implementation Priority
1. LLM-as-judge critique (highest impact, easiest to add)
2. Rubric scoring (automatable, fast)
3. Reference examples (requires user input but very effective)
