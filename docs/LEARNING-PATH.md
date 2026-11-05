# Personalized learning toward PTE Academic

Updated 2026-11-05. PTE Academic is the main learning objective; medical and electrical English are optional contexts. A fresh learner starts with general A1 foundations. Selecting a profession never forces specialist vocabulary into the first lesson.

## Profile and progression

- Each local learner chooses a name, PTE overall target (55/63/71/79/86/90), daily time (5/15/30 minutes), optional interest and a separate starting practice level for Listening, Speaking, Reading and Writing.
- Six practice bands A1–C2 describe authored content difficulty. They are not a validated placement test, a CEFR certificate or a predicted PTE score.
- Every band has at least two general topics. A1 has no profession-specific recommendations. From A2, the chosen profession can appear after two completed general topics at the same band. All library topics remain available for manual exploration.
- If those two general topics already advance the skill, one optional profession topic from the previous band is offered as a bridge. It does not falsely change the current skill band or force every specialist topic before returning to general learning.
- The next daily skill favors the lowest current practice band, then the least practiced skill. Each skill shortcut uses its own band. Selecting B2 listening with A1 writing never makes writing B2.
- At least 10 distinct sentence results from at least two topics at one band, at 80% correctness in up to the latest 20 distinct results, can mark that skill/band practiced and advance that skill one band. Repeating one item cannot create 10 distinct results.
- Listening and speaking results are self-assessed. Reading uses the selected answer; writing retains the first check, so revealing the answer and correcting it does not convert a miss into a correct first attempt. Completion is tracked independently from correctness.
- Five or more results below 60% trigger a recommendation to revisit the most recent difficult topic at that skill's band. The app does not award an exam score for these exercises.
- Changing a starting band clears that skill's progression evidence and earned band markers, preserving the rest of the learner's history. This avoids old evidence immediately overriding an explicit adjustment.
- Daily time is an approximate plan of 1/3/6 short practice blocks, not a measured promise about task duration.

## Storage and continuity

`evc_learners_v1` stores the local profile list and active ID. Each learner's practice is stored at `evc_public_study_v1:<id>`. The original `evc_public_study_v1` remains untouched: the first profile inherits its legacy progress, while subsequent new learners start independently. Existing personal server history and private PTE routes remain behind login.

Export version 2 includes the profile and progress. Import validates the profile and attempts and creates a new independent local learner. Version 1 progress exports still import into the current learner. Profiles are not cloud accounts and do not sync across devices; use export/import to transfer them. No recordings are sent by the free edition.

## Content coverage and limits

48 topics, 240 synthetic MP3 clips: beginner foundations, existing everyday/professional topics, academic argument and research, six general medical topics and nine electrical topics. Each topic supports listening, record-and-compare, meaning recognition and dictation. Higher bands increase sentence complexity; they are supplemental practice, not a complete PTE mock exam.

The public PTE journey surfaces the 22-task catalogue already maintained in `api/content/pte-exam-facts.json`, with its original check date. Its small public projection is generated as `web/src/data/pte-guide.json`; exam facts are not silently changed. Full timed task practice and AI grading remain in the private coach. Public multi-user PTE mock scoring is not implemented by this change.

## Verified score references

Pearson's current scoring page and Test Taker Score Guide (page 12) align PTE 90 overall with IELTS 9.0 overall. This is a concordance, not a guarantee of interchangeable skill scores or exam success. PTE overall is not the arithmetic mean of the four communicative scores.

- https://www.pearsonpte.com/pte-academic/scoring/
- https://www.pearsonpte.com/content/dam/ELL/pte/pearsonpte/resources/PTE-Academic-Test-Taker-Score-Guide.pdf

Checked against both sources on 2026-11-05. The old score-comparison URL now redirects to the scoring page, so the PDF is the independent corroborating source.

Medical content teaches language (reception, clarification, handover, research wording and ethics); it is not diagnosis or treatment instruction. Electrical content likewise teaches language rather than practical electrical procedures.
