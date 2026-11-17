# Promoted trace storage

Keep each promotion immutable in `lakda/traces/<promotionId>/`: `promotion.json` and the trace/suite files named by its `artifactRefs`. Review changes in Git. Every trace that should count as regression must be replayed on every change or on an approved recurring run. Use only approved real targets for release evidence.
