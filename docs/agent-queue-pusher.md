# Agent queue pusher

Work from Warren's agent queue (Antigravity, OpenClaw and local models) is committed on a `mesh/t<id>` branch on the machine that did it, then shipped to the Mac pusher. Before anything reaches `main`, the pusher:

1. rebases the branch onto the current `main`
2. runs `tools/ci/guard.sh` and gitleaks on the new commits
3. runs `nx affected -t check test build`
4. gets a local-model code review

It pushes only when all four pass, using the noreply identity. CI then deploys as usual. If any step fails, the task goes back to the queue with the reason.