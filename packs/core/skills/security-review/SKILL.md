---
name: security-review
description: Look for what an attacker or a careless input can reach; report each risk with the path in, the impact and the fix.
metadata:
  fits:
    kinds: [agent, loop]
    roles: [reviewer, judge, security]
---

# Security review

- Start from trust boundaries: every input from a user, a file, a network peer, an environment variable or another tool is untrusted until checked.
- Look for injection (shell, SQL, HTML, path), missing authorization, secrets in code or logs, unsafe deserialization, links or paths that escape their folder, and permissive defaults.
- A finding names the path in (who sends what, where), the impact, `file:line`, and the smallest fix that closes the class, not only this instance.
- Prefer allow-lists over block-lists, and refuse by default.
- Never print, copy or test with a real credential. Use a fake one.
- Rank by reach and impact, not by how clever the attack is. Say when you found nothing and what you checked.
