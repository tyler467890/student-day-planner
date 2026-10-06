# Suggested goals JSON

The suggestion engine reads two local files:

- `data/suggestions.json` — the cards it can offer (a JSON array)
- `data/gap-rules.json` — frequency settings, synonym concepts, category coverage, and the gap rules

Ship them as a pair. If either file is missing, is not JSON, or fails the checks below, the engine ignores both and uses the built-in seed in `js/suggest.js`. A bad file never takes the app down. The engine does not fetch anything else.

`window.DayliSuggest` (from `js/suggest.js`) is the UI contract:

```js
loadLibrary(): Promise<void>
getSuggestion({ tasks, now, settings, random }): Suggestion | null
markShown(id, now?)
markAccepted(id, taskId, now?)
markDismissed(id, { forever, now })
isSuggestedTask(taskId): boolean
markSuggestedCompleted(taskId): boolean
canNotify(now): boolean

Suggestion = {
  id, title, category, reason,
  difficulty: 'easy' | 'medium' | 'hard',
  suggestedTime?: 'HH:MM',
  repeat: 'daily' | 'weekly' | null,
  quiet: boolean
}
```

`settings.suggestFrequency` is `off`, `rare`, `normal` (default), or `often`. `settings.installedOn` is `YYYY-MM-DD` from the app. `settings.suggestIncludeOlder === true` opts into the teen/adult cards. `random()`, when passed, is a function returning a number in `[0, 1)`. Without it, the daily gate is a stable hash so asking again the same day does not flip the answer.

`quiet` is true during quiet hours. The card is still returned so the app can show it. `canNotify(now)` is false in that window, and the UI should not raise a notification.

## How a list is read

This matches `build/simulate.py` in the data pack (that folder is not shipped).

1. Normalise the goal text: lowercase, turn `&` into `and`, strip emoji and punctuation but keep `-`, `'`, and `:`, then collapse spaces. `Go to school!!!` becomes `go to school`. `Read-chapter, 4` becomes `read-chapter 4`. `Today's homework?` becomes `today's homework`.
2. Split on spaces. Also stem each token by dropping one trailing `ing`, `es`, `ed`, or `s` when the word is longer than the suffix plus 2. `studying` becomes `study`. `shifts` becomes `shift`.
3. A single-word synonym hits a whole token, or that token's stem when the synonym is 4 letters or longer. `work` does not match `homework` or `workout`. `class` does not match `classic`.
4. Synonyms of 3 letters or fewer (`hw`, `pe`, `tv`, `sat`) must equal a whole token.
5. Multi-word or hyphenated synonyms (`go to bed`, `all-nighter`, `energy drink`) match as whole-word substrings.
6. One goal can hit several concepts. `Gym after work` is fitness and work.
7. Scope is open goals plus goals completed in the last 7 days. A recurring goal counts once (same task id). A task counts as closed when it has `done`, `completed`, `skipped`, `completedOn`, `completedAt`, or a status of `done`, `completed`, or `skipped`. Text comes from the title, note, and a specific `categoryId` (`goals` is ignored, so a class category still counts as school).
8. Before offering a category, skip it when any in-scope goal matches that category's `categoryCoverage` concepts. Someone with a bedtime goal is not offered another sleep card. Also skip a card whose title matches a goal title, a card that was dismissed, and a card the user already accepted while that task is still on the list.

A goal scheduled after `orGoalTimeAfter` (24-hour `HH:MM`, compared as text) satisfies that rule's `anyOf` even when the words do not hit. `23:30` is after `22:30`.

## data/suggestions.json

The file is a plain JSON array. There is no wrapper object.

```json
{
  "id": "slp-03",
  "title": "Screens off before bed",
  "category": "sleep",
  "reason": "Turning devices off 30 minutes before bed can help you fall asleep.",
  "difficulty": "medium",
  "suggestedTime": "21:00",
  "repeat": "daily",
  "meta": {
    "timeOfDay": "evening",
    "ageSafe": true,
    "audience": "all",
    "keywords": ["phone", "screens"],
    "sources": ["cdc-sleep"],
    "evidence": "direct"
  }
}
```

| Field | Required | Values |
| --- | --- | --- |
| `id` | yes | non-empty string, unique. Prefixes: `stu`, `slp`, `pro`, `mon`, `hea`, `fit`, `rel`, `wel`, `lrn`, `rlx`. |
| `title` | yes | non-empty string, shown as the goal |
| `category` | yes | one of the 10 categories below, and a key in `categoryCoverage` |
| `reason` | yes | one sentence the card can show |
| `difficulty` | yes | `easy`, `medium`, or `hard` |
| `suggestedTime` | no | `HH:MM` in 24-hour time. This is the goal's time, not when the card may appear. |
| `repeat` | no | `daily`, `weekly`, or omit / `null` for a one-off |
| `meta` | no | extra data. The engine reads `meta.ageSafe` and ignores the rest. |

The shipped library has 132 cards: study 14, sleep 14, productivity 13, money 13, health 13, fitness 13, relationships 13, wellbeing 13, learning 13, relax 13.

`meta.ageSafe === false` marks a teen or adult card. There are 9: `slp-08`, `mon-04`, `mon-05`, `mon-06`, `mon-09`, `mon-11`, `fit-06`, `wel-11`, `wel-12` (caffeine cutoff, budget and pay, banks, bills, adult strength training, social media). Missing `meta.ageSafe` is treated as safe, which is how the built-in seed behaves. By default only safe cards are offered. They are included only when `settings.suggestIncludeOlder === true`.

## data/gap-rules.json

```json
{
  "version": 1,
  "settings": {},
  "matching": {},
  "concepts": { "school": ["school", "class", "lecture"] },
  "categoryCoverage": { "sleep": ["sleep"], "health": ["healthHabits", "hydration"] },
  "rules": [
    {
      "id": "school-no-study",
      "trigger": "missing",
      "description": "Has school or class goals but nothing about studying or homework.",
      "when": { "anyOf": ["school", "exam"], "noneOf": ["study", "homework"] },
      "suggest": ["study"],
      "priority": 90,
      "preferIds": ["stu-05", "stu-01", "stu-09"],
      "preferDifficulty": "easy"
    }
  ]
}
```

`version` is optional and, when present, is an integer ≥ 1. `matching` is notes for humans. The engine does not read it.

### Concepts and coverage

`concepts` is an object of synonym lists (26 in the shipped file). `categoryCoverage` maps each suggestion category to the concepts that mean the user already has that kind of goal:

| Category | Covered by |
| --- | --- |
| study | study |
| sleep | sleep |
| productivity | planning |
| money | money |
| health | healthHabits, hydration |
| fitness | fitness |
| relationships | social |
| wellbeing | wellbeing |
| learning | learning |
| relax | rest |

### Rules

`rules` is a non-empty array. Each rule needs a unique `id`, `trigger` (`missing`, `tooMuch`, or `present`), a `when` object, a non-empty `suggest` list of category ids, and a positive `priority`. `description` is optional and is not shown on the card. `preferIds` is an optional ordered list of suggestion ids in those categories. `preferDifficulty` is optional (`easy`, `medium`, or `hard`).

Every `when` key that is present must pass.

| Key | Passes when |
| --- | --- |
| `anyOf` | at least one goal matches one of the concepts, or `orGoalTimeAfter` saves it |
| `noneOf` | no goal matches any of the concepts |
| `minMatches` | at least this many goals match `anyOf` |
| `minShare` | (goals matching `anyOf`) ÷ (all in-scope goals) is at least this fraction (`0.4` means 40%) |
| `minGoals` / `maxGoals` | size of the in-scope list |
| `orGoalTimeAfter` | `anyOf` also passes when a goal's `time` is after this `HH:MM` |
| `orMinGoals` and `orMinHard` | the list is at least `orMinGoals` long, or at least `orMinHard` goals are `hard` |

The shipped file has 23 rules, highest priority first. A few of the gates: school or an exam with no study (`school-no-study`, 90), three or more work or chore goals that are at least 40% of the list and no rest (`work-heavy-no-rest`, 85), a goal after 22:30 (`late-night`, 86), and 0–2 goals (`new-user`, 20, easy cards from sleep, health, fitness, wellbeing, relationships).

### Picking a card

1. Keep the rules whose `when` passes and that still have a category that is not covered, not snoozed, and has an unseen card.
2. Pick one of those rules at random, weighted by `priority`. The shipped `rulePickStrategy` is `weighted-random-by-priority`.
3. Walk that rule's `preferIds` in order. Skip ids that are dismissed, accepted, not age-safe, or in a covered or snoozed category.
4. Otherwise pick a random unseen card from the rule's categories, preferring `preferDifficulty` when the rule sets it, otherwise easy. If none of that difficulty are left, any difficulty in those categories is fine.
5. If no rule is usable and `fallbackWhenNoRuleFires` is `random-category-easy`, pick an easy unseen card from a category that is not covered or snoozed. If nothing is left, return `null`.

## Settings and how often a card appears

`settings` in `gap-rules.json` is the behaviour for `suggestFrequency: "normal"`. The engine reads these numbers from the file. The built-in seed uses the same numbers only when a fallback library has no `settings` block.

Shipped values:

| Field | Normal behaviour |
| --- | --- |
| `maxPerDay` | 1 per local calendar day |
| `maxPerWeek` | 2 in a rolling 7 days |
| `showChanceWhenEligible` | 0.3 on the first look of an eligible day |
| `minDaysBetweenSuggestions` | 3 days (72 hours) since the last card |
| `cooldownAfterDismissDays` | 7 days after "not now" |
| `cooldownAfterAcceptDays` | 3 days after an accept, for every card |
| `neverRepeatDismissedIds` | a forever dismissal never returns |
| `categorySnoozeAfterDismissals` | 3 dismissals of one category inside 30 days snoozes that category for 30 days from the third dismissal |
| `doNotResuggestAcceptedWhileGoalExists` | do not offer an accepted id while its task is still on the list |
| `resuggestAcceptedAfterDays` | 90 days after the accept, once that task is gone |
| `minDaysSinceFirstUse` | no cards on the install day or the next day. Needs `settings.installedOn`. If that date is missing, this gate stays open. |
| `skipIfOpenGoalsAtLeast` | no cards when 12 or more goals are still open. Completed goals do not count. The same recurring id counts once. |
| `quietHours` | `21:00`–`07:00`. 21:00 is quiet. 07:00 is not. |
| `ageSafeOnlyByDefault` | true |
| `showOnlyAtAppOpen` | the UI should ask on app open. The engine cannot see that, so it answers whenever it is asked. |
| `avoidWhenAllTodayGoalsDone` | false in the shipped file. When true, a list whose every goal is already closed returns `null`. |
| `minGoalsBeforeGapRules` | 3. The broad "nothing here yet" rules already set their own `minGoals`. The engine does not apply this a second time, so one school goal can still suggest study. |

`rare` is about half as often: half the show chance (0.15), twice the gap (6 days), and half the weekly cap (1). The daily cap stays 1.

`often` is about twice as often, and still at most one a day: show chance 0.6, gap 1.5 days, weekly cap 4, daily cap 1.

`off` returns `null`.

Dismiss, accept, category snooze, the first two days, the open-goal cap, and quiet hours are not scaled.

A show that is exactly 7 days old drops out of the weekly window. A gap of exactly `minDaysBetweenSuggestions` is allowed. "Not now" can return exactly `cooldownAfterDismissDays` later. Forever means never, even after that.

Quiet hours do not suppress the return value. The suggestion includes `quiet: true`, and `canNotify(now)` is false, from 21:00 inclusive until 07:00 exclusive. Wind-down cards keep their evening `suggestedTime`; that is the goal's time, not the offer time.

## Older library shape

The seed in `js/suggest.js`, and any file pair that still uses it, is accepted as a fallback. `suggestions.json` is `{ "version", "suggestions": [...] }`. `gap-rules.json` has `categories` (keywords and `lifeImprovement`) and rules with `kind` `missing` or `too-much` and `weight`.

- `missing` uses `when.has` (all of these), `when.hasAny` (at least one), and `when.missing` (none of these).
- `too-much` matches when the category has at least `count` goals, **or** more than `percent` of the list once the list is at least `minTasks` long (default 4).

Those files are compiled into the same picker. `weight` becomes `priority`. If they omit `settings`, the shipped normal numbers above are used. A file that looks like the new format but does not validate is not read as the old format; both files fall back to the seed.
