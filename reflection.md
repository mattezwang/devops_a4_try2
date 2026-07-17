# Reflection

The most interesting thing I learned was how much leverage a dedicated
"review" stage has when the actual work is delegated to a stateless,
unattended agent. In the step-1 review stage, a fresh `claude -p` invocation
that had never seen the spec-writing process caught a genuine arithmetic bug
in the spec's own worked example — Alice's balance was off by exactly one
cent because the example silently assumed the wrong member got the rounding
remainder — and produced a corrected, deterministic rule that the build
stage later implemented and a smoke test verified byte-for-byte. Had that
review not existed, the bug would have been invisible until someone eyeballed
production output, since the build agent would have had no reason to doubt
a spec it was told to trust. The second thing that mattered just as much was
giving the build-stage loop an unambiguous, mechanically-checkable
success condition (a smoke test plus a strict rule that the stop token may
only be printed after personally observing that test pass in the same
iteration) — without that forcing function, an agent under pressure to
"finish" has every incentive to declare victory prematurely, and with it,
both build loops in this project converged to a genuinely working,
independently-verified state rather than a plausible-looking one.
