# P0b: pre-set levels for false alarms and catch retention

Piece: mipro27-bdd-agent-e2e. Read on 2026-11-27. Open-access sources only. Every number below was read in
the source text itself. Where a source does not say something, this file says NOT FOUND.

## Proposed levels

| Level | Proposed value | Basis |
|---|---|---|
| (a) False alarms: share of scenario runs that fail on a healthy build | **at most 1.5% per scenario run** | Google's reported fleet-wide flaky rate (S1). Google tolerates this rate in practice but does not endorse it. No source states an *acceptable* rate. |
| (b) Catch retention: share of the bugs the maintained coded suite catches that the agent also catches | **at least 95%** | Facebook's deployed predictive test selection (S4): ">95% of individual test failures", which the authors call "sufficient" in production. That system also has a later full-suite stage as a safety net. The agent arm would have no safety net, so 95% is, if anything, lenient. |

How the fallback compares. The 10% false-alarm fallback has **no source**: it would be our choice and is
about 7× Google's reported rate. The 80% retention fallback matches the *worst* observed fault-detection loss
of coverage-preserving test-suite reduction in Shi et al. 2014 (S5: up to 20.5% of killed mutants lost).
That is an observed worst case, not a level anyone states as acceptable. If the plan keeps 80% / 10%, the
paper must label them as our choice and not attribute them to these sources.

Sample-size check (rule of three, 95% one-sided). This is our arithmetic, not taken from a source:
- To claim a false-alarm rate ≤ 1.5% with zero false alarms observed, about 200 healthy-build scenario runs
  per arm are needed (3/200 = 1.5%). With fewer runs, report the observed rate and its interval against the
  1.5% line. Do not claim the agent meets the level.
- To claim ≥ 95% retention with no misses observed, about 60 bug-detection opportunities that the coded suite
  catches are needed (1 − 3/60 = 95%). With fewer, report the interval against the line.

## Sources: (a) false alarms on a correct build

**S1. Micco, "Flaky Tests at Google and How We Mitigate Them", Google Testing Blog, 2016-05-27**
- URL: https://testing.googleblog.com/2016/05/flaky-tests-at-google-and-how-we.html
- Read depth: full post body (from the page HTML; sha256 of the fetched HTML is 632bb1fa…115a).
- "across our entire corpus of tests, we see a continual rate of about 1.5% of all test runs reporting a
  'flaky' result." A flaky result is "a test that exhibits both a passing and a failing result with the same
  code."
- "Almost 16% of our tests have some level of flakiness associated with them!" The post calls this
  "a staggering number".
- "about 84% of the transitions we observe from pass to fail involve a flaky test!"
- "the insertion rate is about the same as the fix rate, meaning we are stuck with a certain rate of tests".
  This is a tolerated rate, not an endorsed one.
- Worked example in the post: about 1,000 tests per project; "If 1.5% of test results are flaky, 15 tests
  will likely fail".
- Caveat: these figures cover all of Google's tests (unit through UI). They are not specific to E2E or browser
  tests. An E2E-specific rate is NOT FOUND.

**S2. Memon et al., "Taming Google-Scale Continuous Testing", ICSE-SEIP 2017**
- URL (Google-hosted PDF): https://research.google.com/pubs/archive/45861.pdf (sha256 bf607da9…a48f)
- Read depth: Sections I and III, Tables I and II (pp. 1–5), extracted text.
- Table II: 5,562,881 total test targets. 115,160 "PASSED at least once AND FAILED at least once".
  "Flakes 46,694 of 115,160".
  Derived by us: 0.84% of all targets were flaky over the study period. Flakes are 40.5% of the targets that
  both passed and failed.
- Section I: "more than 99% of all tests run by the CI system pass or flake". Also "it is impossible to weed
  out all flaky tests".

**S3. Luo, Hariri, Eloussi, Marinov, "An Empirical Analysis of Flaky Tests", FSE 2014**
- URL (author copy): http://mir.cs.illinois.edu/marinov/publications/LuoETAL14FlakyTestsAnalysis.pdf
  (sha256 36abbab3…823b)
- Read depth: Section 1 (introduction), extracted text. The rest was scanned for percentages.
- Section 1: "the TAP system at Google had 1.6M test failures on average each day in the past 15 months, and
  73K out of 1.6M (4.56%) test failures were caused by flaky tests." The paper says these were "the only
  specific numbers we could obtain".
- Also Section 1: "at Google, a failing test is rerun 10 times against the same code version on which it
  previously failed, and if it passes in any of those 10 reruns, it is labeled as a flaky test".
- Luo et al. give a *share of failures*, not a per-run rate. The paper's own findings concern root causes
  and fixes. Luo et al. give no acceptable level (NOT FOUND).

**S4b (flakiness side of S4).** Machalica et al., Section V: in their sampled learning runs, the number of flaked
test targets "is about four times larger than" the number of failed test targets. No per-run rate is given.

**Checked, but gave no usable rate.** Herzig & Nagappan, "Empirically Detecting False Test Alarms Using
Association Rules", ICSE-SEIP 2015 (Microsoft Windows and Dynamics):
https://www.microsoft.com/en-us/research/wp-content/uploads/2015/05/Empirically-Detecting-False-Test-Alarms-Using-Association-Rules.pdf
- Read depth: pp. 1–6, extracted text.
- The paper reports classifier precision of 0.85–0.90 and recall of 0.34–0.48 for detecting false alarms.
- The base share of false alarms among failures was NOT FOUND in the part we read. A share of "about 5%"
  attributed to Herzig & Nagappan appears in secondary citations. It was not verified, so it is not used.
- The Microsoft flaky-test papers by Lam et al. (ISSTA 2019, ICSE 2020) were not read. The author PDFs
  returned a bot-check page. NOT FOUND.

## Sources: (b) catch retention against a maintained suite

**S4. Machalica, Samylkin, Porth, Chandra, "Predictive Test Selection", ICSE-SEIP 2019 (Facebook)**
- URL: https://arxiv.org/abs/1810.05286. Read as https://ar5iv.labs.arxiv.org/html/1810.05286
  (sha256 089ac3dd…a1c).
- Read depth: abstract, Sections I, II-B, V and VI-A, full text searched.
- Abstract: "Deployed in production, the strategy reduces the total infrastructure cost of testing code
  changes by a factor of two, while guaranteeing that over 95% of individual test failures and over 99.9% of
  faulty changes are still reported back to developers."
- Section VI-A: "we fail to report only <5% of individual test failures and <0.1% of faulty changes. Based on
  our experience operating such test selection strategy in production for several months, the described
  correctness guarantees are sufficient. Note that any faulty change that makes it into the master branch
  will be detected in the stabilization stage."
- Section I: "A code change is marked faulty if any of the individual tests run in response to the code change
  fails; typically it is the recall of the faulty code changes that matters."
- Caveats. Retention is measured against the tests selected by build dependencies, not against a full manual
  suite. A later full-test stage catches misses. The 95% and 99.9% targets were set by calibration; the paper
  gives no further justification for those particular numbers.

**S5. Shi, Gyori, Gligoric, Zaytsev, Marinov, "Balancing Trade-Offs in Test-Suite Reduction", FSE 2014**
- URL (author copy): https://mir.cs.illinois.edu/gyori/pubs/fse14reduction.pdf (sha256 f151c29b…8a1c)
- Read depth: Sections 1–3 and 4.3, extracted text.
- Setting: 18 projects, 261,235 tests, 3,590 commits.
- Section 4.3: "For SAR [statement-adequate reduction], the original loss in killed mutants ranges from 0.2% to
  20.5%". "the loss in killed mutants for the traditional SAR does not rise above 20.5%". Prior studies
  "found significant losses (around 40%-50% in most cases) in fault-detection capability". Random reduction
  lost "up to … 55.7%" of killed mutants, and the authors "do not suggest its use in practice".
- Section 3 (inadequate reduction) uses example levels such as "95% of the statements covered by the original
  test suite". The paper says "it may be acceptable to have some loss" when cutting size. No numeric
  acceptable level is stated (NOT FOUND).

**S6. Shi, Yung, Gyori, Marinov, "Comparing and Combining Test-Suite Reduction and Regression Test Selection",
ESEC/FSE 2015**
- URL (author copy): https://mir.cs.illinois.edu/gyori/pubs/fse15.pdf (sha256 07fd332b…c3eabc)
- Read depth: abstract, Sections 1–2 and the RQ2 results, extracted text.
- Setting: 4,793 commits, 17 projects.
- RQ2: the per-project median change-related loss in killed mutants was "as high as 5.93% (for JOPT-Simple)".
  Change-related statement-coverage loss had a median of "at most 2.74%".
- Section 1: missing some faults "may still be tolerable in some contexts … the full test suite could be run
  more rarely". No numeric tolerance is given (NOT FOUND).

**Not read.** Hao et al., "On-demand Test Suite Reduction", ICSE 2012. Its abstract describes user-set bounds:
"at most l% loss in fault-detection capability for at least c% of the instances". No open full text was found,
so the values of l and c it evaluates are NOT FOUND.

## Reasoning in short

- (a) No source states an acceptable false-alarm rate. The best-documented rate tolerated in practice is
  Google's 1.5% of all test runs (S1). It is backed by Memon et al.'s 0.84% of targets ever flaky (S2) and
  4.56% of failures flaky (S3).
  - Using 1.5% sets the agent the same bar as a large maintained suite, which is what a reader would compare
    against.
  - 10% has no source behind it.
- (b) The only source that calls a retention level acceptable is Facebook's deployed test selection: over 95%
  of individual failures, with production experience called "sufficient" (S4). The test-suite reduction
  literature reports observed losses of 0.2–20.5% (S5) and medians up to 5.93% (S6). It sets no threshold.
  80% matches the worst observed reduction loss, not an endorsed level.
- If the plan instead keeps 80% / 10%, label both as our choice in the plan and in the paper, and cite S1 and
  S4 as context only.
