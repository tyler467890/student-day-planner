# Suggested goals JSON

The suggestion engine reads two local files:

- `data/suggestions.json` — the cards it can offer
- `data/gap-rules.json` — how it reads the user's list, and which categories to prefer

Ship them as a pair. If either file is missing, is not JSON, or fails the checks below, the engine ignores both and uses the built-in seed in `js/suggest.js`. A bad file never takes the app down.

Drop-in replacements can use the same shapes. Extra fields are ignored. The engine does not fetch anything else.

The JSON blocks in this doc are the shape, not a whole file. The full seed set is `data/suggestions.json` and `data/gap-rules.json`.

## How a list is read

Goal text is normalised before matching: lowercase, punctuation stripped, whitespace collapsed. `Go to school!!!` and `go to school` are the same. `Read-chapter, 4` becomes `read chapter 4`.

A keyword hits when it appears as a whole word or a whole phrase. `class` matches `math class` and does not match `classic`. `read chapter` matches `read chapter 4`. Synonyms are just more keywords on that category.

A task counts toward every category whose keywords hit its title, note, or a specific `categoryId` (the generic id `goals` is ignored).

A suggestion is skipped when it already looks listed:

- any current task falls in the suggestion's category
- the normalised titles match, or one contains the other (the shorter one at least 12 characters)
- a keyword that appears in the suggestion title also appears in a task
- the user already accepted that suggestion and that task is still on the list

Life-improvement categories (`lifeImprovement: true`) are the fallback. They keep a weight of 1 even when no rule points at them. Other categories are offered only when a rule points at them.

## data/suggestions.json

```json
{
  "version": 1,
  "suggestions": [
    {
      "id": "study-block",
      "title": "Study for 25 minutes",
      "category": "study",
      "reason": "School is on your list, and a short study block keeps the classwork from piling up.",
      "difficulty": "easy",
      "suggestedTime": "16:30",
      "repeat": "daily"
    }
  ]
}
```

| Field | Required | Values |
| --- | --- | --- |
| `version` | no | integer ≥ 1 |
| `suggestions` | yes | non-empty array, unique `id`s |
| `id` | yes | non-empty string |
| `title` | yes | non-empty string, shown as the goal |
| `category` | yes | must be a category id in `gap-rules.json` |
| `reason` | yes | one sentence the card can show. Write it so it is still true when the rules that point at this category match. Fallback cards should make sense on their own. |
| `difficulty` | yes | `easy`, `medium`, or `hard` |
| `suggestedTime` | no | `HH:MM` in 24-hour time, such as `07:30` or `16:30` |
| `repeat` | no | `daily`, `weekly`, or `null` |

## data/gap-rules.json

```json
{
  "version": 1,
  "categories": {
    "study": {
      "label": "Study",
      "lifeImprovement": false,
      "keywords": ["study", "homework", "revise", "revision", "exam", "read chapter"]
    },
    "school": {
      "label": "School",
      "lifeImprovement": false,
      "keywords": ["school", "class", "lecture"]
    },
    "relax": {
      "label": "Relax",
      "lifeImprovement": true,
      "keywords": ["relax", "unwind", "break", "hobby"]
    }
  },
  "rules": [
    {
      "id": "school-without-study",
      "description": "School or class is on the list, and nothing looks like studying.",
      "kind": "missing",
      "when": { "has": ["school"], "missing": ["study"] },
      "suggest": ["study"],
      "weight": 8
    },
    {
      "id": "work-heavy",
      "description": "Work is more than 40% of the list, or at least 3 work items.",
      "kind": "too-much",
      "when": { "category": "work", "percent": 40, "count": 3, "minTasks": 4 },
      "suggest": ["relax"],
      "weight": 9
    }
  ]
}
```

### Categories

| Field | Required | Values |
| --- | --- | --- |
| `version` | no | integer ≥ 1 |
| `categories` | yes | object with at least one id |
| category id | yes | no spaces. Suggestions and rules use this id. |
| `label` | no | short name. Defaults to the id. |
| `lifeImprovement` | no | `true` or `false`. Default `false`. `true` means this category can be offered as a general life goal (sleep, productivity, money, health, social, and so on) even when no gap rule names it. |
| `keywords` | yes | non-empty array of phrases. These are the synonyms. |

### Rules

`rules` is an array (it may be empty). Each rule needs a unique `id`, a `kind`, a `when` object, a non-empty `suggest` list, and a positive `weight` (default 1). `description` is optional and is not shown to the student.

`suggest` is a list of category ids, or `{ "category", "weight" }` objects when one rule should prefer one category over another. Every id must exist in `categories`.

Weights add up. A matching rule adds its weight to each category it suggests. Life-improvement categories also get +1. The engine then picks at random, biased toward the higher weight. It never picks a suggestion that already looks listed, was dismissed forever, or is inside a 7-day snooze.

#### `kind: "missing"`

Use this when the list has one kind of goal and lacks another. `has school` but no `study`. Or there is simply no sleep goal.

| `when` field | Meaning |
| --- | --- |
| `has` | every listed category is present. Omit it, or use `[]`, when there is no prerequisite. |
| `hasAny` | at least one listed category is present. Omit it when unused. |
| `missing` | required. Every listed category is absent. |

`has` and `hasAny` are AND and OR. Both can be set. The rule matches only when all of them hold.

#### `kind: "too-much"`

Use this when one category crowds the list. More than N% **or** at least K items. Either threshold is enough.

| `when` field | Meaning |
| --- | --- |
| `category` | required category id |
| `percent` | matches when that category is **more than** this percent of the tasks passed in |
| `count` | matches when that category has **at least** this many tasks |
| `minTasks` | percent is ignored until the list is at least this long. Default `4`, so one or two items cannot count as "100% work". Set `0` to let percent apply to any list. |

At least one of `percent` or `count` is required.

## Frequency

This is not in the JSON. The UI passes `settings.suggestFrequency`:

| Value | Cap | Extra roll |
| --- | --- | --- |
| `off` | never | |
| `rare` | at most once every 3 days (72 hours) | about 1 in 3 eligible windows |
| `normal` | at most one per local calendar day. Default. | about half of eligible days |
| `often` | at most two per local day, at least 4 hours apart | about 7 in 10 eligible slots |

The roll is stable for a given day and slot, so asking again a minute later does not change the answer. `off`, cooldown, a failed roll, or nothing left that fits all return `null`.

Dismiss forever and that id never returns. Dismiss without `forever` (not now) snoozes that id for 7 days. Shown, accepted, and dismissed ids are stored with timestamps on the device.
