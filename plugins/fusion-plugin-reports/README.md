# Reports Plugin for Fusion

Generates HTML system activity reports with multi-agent review.

## Review Panel

The plugin exposes `runReviewPanel()` / `runGeneratedReportReview()` to fan out a generated report draft to multiple reviewer agents in parallel.

### Panel member settings shape

Each reviewer uses this contract:

```ts
{
  id: string;
  name: string;
  perspective: string;
  promptTemplateId?: string;
  provider?: string;
  modelId?: string;
}
```

- `perspective` is appended to the reviewer system prompt.
- `promptTemplateId` selects a template from `settings.reviewPromptTemplates[templateId]` when present.
- `provider` + `modelId` optionally override model selection per reviewer.

### Prompt template contract

`runReviewPanel` resolves reviewer templates in this order:

1. `settings.reviewPromptTemplates[promptTemplateId ?? id]`
2. `settings.reviewPrompt`
3. Built-in fallback (`DEFAULT_REVIEW_PROMPT`)

This is the temporary compatibility contract until FN-3782 lands shared review-template helpers.

### Individual review shape

```ts
{
  memberId: string;
  memberName: string;
  perspective: string;
  verdict: "approve" | "revise" | "reject";
  summary: string;
  highlights: string[];
  lowlights: string[];
  suggestions: string[];
  rawText: string;
  durationMs: number;
}
```

### Combined review shape

```ts
{
  overallVerdict: "approve" | "revise" | "reject";
  consensusSummary: string;
  mergedHighlights: string[];
  mergedLowlights: string[];
  mergedSuggestions: string[];
  individual: IndividualReview[];
  failures: ReviewFailure[];
}
```

Aggregation is deterministic:

- verdict precedence: `approve < revise < reject`
- merged arrays are case-insensitive de-duped, first-seen order, max 25 items each
- consensus summary is generated locally from reviewer summaries (no second AI call)

### Timeout and failure semantics

- Each reviewer has a hard timeout (`120_000ms`).
- A single reviewer failure never aborts the full panel.
- Failures are returned as:

```ts
{
  memberId: string;
  reason: "timeout" | "parse_error" | "session_unavailable" | "exception";
  message: string;
}
```

- If all reviewers fail, combined verdict is `reject` with an explicit consensus summary describing panel failure.
