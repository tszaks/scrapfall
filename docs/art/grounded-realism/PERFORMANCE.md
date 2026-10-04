# Performance evidence

Read the method and limitations in [README](README.md). Raw reports include setup, poses, quality logs, startup tasks, shader events and frame statistics. All frame times below include the complete measured interval.

## Final active-combat comparisons

| Run                | p95 ms | p99 ms | Worst ms | >16.7 ms / frames | >25 / >50 ms |
| ------------------ | -----: | -----: | -------: | ----------------: | -----------: |
| vice baseline      |    9.5 |   13.6 |     76.3 |           18/6693 |          6/1 |
| vice candidate     |   10.5 |   14.5 |    111.7 |           15/6016 |          6/3 |
| pier baseline      |   11.1 |   20.3 |     58.2 |          126/7016 |         35/1 |
| pier candidate     |    4.6 |    6.2 |    129.4 |           9/11519 |          2/2 |
| whiteout baseline  |   23.3 |   37.7 |     99.2 |          685/4117 |       159/14 |
| whiteout candidate |    5.6 |    8.0 |     55.9 |          12/10149 |          5/1 |
| gulch baseline     |   13.1 |   17.9 |    303.9 |          103/5745 |         16/4 |
| gulch candidate    |    8.3 |   11.9 |    258.1 |           25/6832 |          9/5 |

| Run                | CPU render-submit mean / p95 ms | GPU render-pass p95 ms | Draw calls mean | Triangles mean |
| ------------------ | ------------------------------: | ---------------------: | --------------: | -------------: |
| vice baseline      |                       3.7 / 7.3 |                    8.4 |           297.7 |      2,546,872 |
| vice candidate     |                       4.3 / 8.1 |                    8.8 |           310.2 |      3,147,686 |
| pier baseline      |                       3.2 / 5.6 |                    4.9 |           165.0 |      1,131,455 |
| pier candidate     |                       1.8 / 2.9 |                    3.7 |           168.6 |      1,128,135 |
| whiteout baseline  |                       4.1 / 9.9 |                    9.1 |           123.0 |      2,910,763 |
| whiteout candidate |                       2.4 / 4.0 |                    4.6 |           147.6 |      2,904,487 |
| gulch baseline     |                       3.0 / 5.5 |                    9.0 |           146.0 |      2,280,218 |
| gulch candidate    |                       2.9 / 4.9 |                    6.8 |           149.6 |      2,270,545 |

## After the first 10 measured seconds

This subset does not prove warm steady-state: new variants and other long tasks can still occur later. Whole-run hitches above remain part of the result.

| Run                | p95 / p99 ms | Worst ms | >16.7 ms / frames |
| ------------------ | -----------: | -------: | ----------------: |
| vice baseline      |   9.4 / 13.3 |     26.5 |           14/5011 |
| vice candidate     |  10.5 / 14.5 |    111.7 |           11/4475 |
| pier baseline      |  12.6 / 23.0 |     58.2 |          124/4721 |
| pier candidate     |    4.6 / 6.0 |    129.4 |            8/8605 |
| whiteout baseline  |  22.7 / 35.9 |     99.2 |          482/3164 |
| whiteout candidate |    5.6 / 8.4 |     40.8 |            9/7570 |
| gulch baseline     |  12.8 / 17.6 |    303.9 |           64/4320 |
| gulch candidate    |   8.5 / 12.3 |    258.1 |           20/5054 |

## Vice stress and close-foliage pairs

4× CPU uses the same rain/wave 4 diagnostic for 30 seconds. Foliage uses sunny tour mode, a matched walkable start 4 m from the closest tree, camera aimed into the crown, alternating A/D movement and continuous firing for 30 seconds. It exercises near alpha coverage and its shadow pass; it is not the combat route. AUTO is a separate dynamic-resolution/tier run, not equivalent to HIGH.

| Run               | p95 ms | p99 ms | Worst ms | >16.7 ms / frames | >25 / >50 ms |
| ----------------- | -----: | -----: | -------: | ----------------: | -----------: |
| baseline-cpu4     |   35.3 |   60.4 |    110.1 |          866/1487 |       697/22 |
| candidate-cpu4    |   35.6 |   66.2 |    110.6 |          889/1385 |       635/29 |
| baseline-auto4    |   33.1 |   50.0 |    116.0 |          290/1957 |       153/18 |
| candidate-auto4   |   34.1 |   52.0 |     96.7 |          415/1841 |       268/25 |
| baseline-foliage  |    9.4 |   14.8 |     37.5 |           39/5618 |          6/0 |
| candidate-foliage |    9.9 |   14.2 |     29.5 |           31/5333 |          7/0 |

| Run               | Average uncapped fps | CPU submit mean ms | GPU p95 ms | Final tier / DPR |
| ----------------- | -------------------: | -----------------: | ---------: | ---------------- |
| baseline-cpu4     |                 49.5 |                9.5 |        5.7 | high / 2         |
| candidate-cpu4    |                 46.1 |               10.4 |        6.8 | high / 2         |
| baseline-auto4    |                 65.2 |                6.1 |        4.5 | low / 1          |
| candidate-auto4   |                 61.3 |                6.8 |        3.4 | low / 1          |
| baseline-foliage  |                187.2 |                2.6 |        6.1 | high / 2         |
| candidate-foliage |                177.7 |                2.9 |        6.4 | high / 2         |

Close-foliage start/target match: **PASS**.

## Source and run order

- [baseline-a](evidence/baseline-a.json): 5bc373dd147a6b4401c1131d77e9d5190621a770, 2026-10-04T15:41:27.612Z; 40s, CPU×1.
- [baseline-c](evidence/baseline-c.json): 5bc373dd147a6b4401c1131d77e9d5190621a770, 2026-10-04T16:12:19.605Z; 40s, CPU×1.
- [baseline-e](evidence/baseline-e.json): 5bc373dd147a6b4401c1131d77e9d5190621a770, 2026-10-04T16:29:34.014Z; 40s, CPU×1.
- [candidate-d](evidence/candidate-d.json): c337d4652805edd1469e5ff0b24ebaedc0c36429, 2026-10-04T16:22:32.468Z; 40s, CPU×1.
- [candidate-e](evidence/candidate-e.json): f9584d7af039ee84145cca5e196a9ba4f628e307, 2026-10-04T16:30:36.555Z; 40s, CPU×1.
- [candidate-final-maps](evidence/candidate-final-maps.json): f9584d7af039ee84145cca5e196a9ba4f628e307, 2026-10-04T16:38:00.745Z; 40s, CPU×1.
- [baseline-cpu4](evidence/baseline-cpu4.json): 5bc373dd147a6b4401c1131d77e9d5190621a770, 2026-10-04T16:31:39.344Z; 30s, CPU×4.
- [candidate-cpu4](evidence/candidate-cpu4.json): f9584d7af039ee84145cca5e196a9ba4f628e307, 2026-10-04T16:32:36.613Z; 30s, CPU×4.
- [baseline-foliage](evidence/baseline-foliage.json): 5bc373dd147a6b4401c1131d77e9d5190621a770, 2026-10-04T16:33:37.770Z; 30s, CPU×1.
- [candidate-foliage](evidence/candidate-foliage.json): f9584d7af039ee84145cca5e196a9ba4f628e307, 2026-10-04T16:34:22.995Z; 30s, CPU×1.
- [baseline-auto4](evidence/baseline-auto4.json): 5bc373dd147a6b4401c1131d77e9d5190621a770, 2026-10-04T16:36:02.093Z; 30s, CPU×4.
- [candidate-auto4](evidence/candidate-auto4.json): f9584d7af039ee84145cca5e196a9ba4f628e307, 2026-10-04T16:36:59.601Z; 30s, CPU×4.

The intermediate candidate-d preceded the facade-culling optimization. Its Vice GPU p95 was 10.03 ms; candidate-e is 8.76 ms, versus paired baseline 8.38 ms. Added draw batches trade some CPU submission for less distant geometry. The initial baseline-a overlaps a unit-test run and is retained only to disclose variability; baseline-c/e are the main comparisons. No task-owned GPU job ran concurrently with the main measurements. Background system activity remains a limitation. Dirty flags on final reports reflect documentation/diagnostic edits; shipped game source matches the recorded implementation head.

Program-count changes are evidence of variant activity, not proof that every hitch is compilation. Counts also cannot detect a replacement that leaves the total unchanged. Late frame spikes are retained and need follow-up; this report does not establish sustained, hitch-free 60 fps or universal device support.
